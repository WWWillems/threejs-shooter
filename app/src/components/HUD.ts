import type { IsometricControls } from "./IsometricControls";
import { WeaponType, type Weapon } from "./Weapon";
import type { NetworkClient } from "../net/NetworkClient";
import {
  GAME_EVENTS, WEAPONS,
  GRENADE_LOADOUT,
  TEAMS,
  emptyTeamScores,
  isWeaponId,
  type DamageSource,
  type GrenadeKind,
  type LeaderboardEntry,
  type Team,
  type TeamScores,
} from "@threejs-shooter/shared";
import { sfx } from "../audio/sfx";
import { Chat } from "./Chat";
import { GRENADE_LABELS, grenadeIcon } from "./grenadeIcons";
import { renderTeamTable } from "./leaderboardTable";

type LeaderboardPlayer = LeaderboardEntry;

const TEAM_LABEL: Record<Team, string> = { blue: "Blue", red: "Red" };

type WeaponSlotState = {
  identity: Weapon["id"];
  selected: boolean;
  iconElement: HTMLElement;
  ammoElement: HTMLElement;
  reloadOverlayElement: HTMLElement | null;
};

export class HUD {
  private container: HTMLElement;
  private uiOverlay: HTMLElement;
  private fpsElement: HTMLElement | null = null;
  private currentAmmoElement: HTMLElement | null = null;
  private totalAmmoElement: HTMLElement | null = null;
  private reloadIndicatorElement: HTMLElement | null = null;
  private emptyMagElement: HTMLElement | null = null;
  private noAmmoElement: HTMLElement | null = null;
  private emptyMagTimeout: number | null = null;
  private noAmmoTimeout: number | null = null;
  // Add notification elements
  private notificationContainer: HTMLElement | null = null;
  private activeNotifications: Map<
    string,
    { element: HTMLElement; timeoutId: number }
  > = new Map();
  /** Insertion order of currently visible notifications, oldest first, so the feed can cap itself. */
  private notificationOrder: string[] = [];
  /** Counter-Strike-style feeds only ever show a handful of rows at once. */
  private static readonly MAX_VISIBLE_NOTIFICATIONS = 5;
  /** Name + team for every player seen so far, so kill feed rows can be colored without a lookup event. */
  private readonly playerInfo = new Map<string, { name: string; team: Team }>();
  // Death overlay
  private deathOverlay: HTMLElement | null = null;
  private leaderboardElement: HTMLElement | null = null;
  private leaderboardVisible = false;
  private leaderboardData: LeaderboardPlayer[] = [];
  private teamScores: TeamScores = emptyTeamScores();
  private leaderboardUpdateInterval: number | null = null;
  private teamScoreElements: Record<Team, HTMLElement | null> = { blue: null, red: null };
  private teamChipElements: Record<Team, HTMLElement | null> = { blue: null, red: null };
  private teamChipElement: HTMLElement | null = null;
  private readonly chat: Chat;

  private weaponSlots: HTMLElement[] = [];
  private weaponSlotStates: Array<WeaponSlotState | null> = [];
  private healthBarElement: HTMLElement | null = null;
  private healthValueElement: HTMLElement | null = null;
  private armorBarElement: HTMLElement | null = null;
  private armorValueElement: HTMLElement | null = null;
  private crosshairElement: HTMLElement | null = null;
  private nicknameElement: HTMLElement | null = null;
  private throwableDisplayElement: HTMLElement | null = null;
  private throwableCooldownOverlayElement: HTMLElement | null = null;
  private throwableIconElement: HTMLElement | null = null;
  private throwableKindElement: HTMLElement | null = null;
  private throwableCountElement: HTMLElement | null = null;
  /** The kind the throwable slot currently draws, so the icon is swapped only on change. */
  private throwableKindShown: GrenadeKind | null = null;
  /** The count the throwable slot currently shows, so the text is touched only on change. */
  private throwableCountShown = -1;

  // Mouse position tracking
  private mouseX = 0;
  private mouseY = 0;
  private isMousePositionDirty = false;

  // FPS tracking
  private frameCount = 0;
  private lastTime = performance.now();

  constructor(
    container: HTMLElement,
    private controls: IsometricControls,
    private net: NetworkClient
  ) {
    this.container = container;
    this.uiOverlay = this.createUIOverlay();
    this.container.appendChild(this.uiOverlay);
    this.chat = new Chat(this.uiOverlay, controls, net);

    // Get references to elements
    this.fpsElement = document.getElementById("fps");
    this.currentAmmoElement = document.getElementById("current-ammo");
    this.totalAmmoElement = document.getElementById("total-ammo");
    this.reloadIndicatorElement = document.getElementById("reload-indicator");
    this.emptyMagElement = document.getElementById("empty-mag-indicator");
    this.noAmmoElement = document.getElementById("no-ammo-indicator");
    this.notificationContainer = document.getElementById(
      "notification-container"
    );
    this.deathOverlay = document.getElementById("death-overlay");
    this.leaderboardElement = document.getElementById("leaderboard");
    this.teamChipElement = document.getElementById("team-score-chip");
    for (const team of TEAMS) {
      this.teamScoreElements[team] = document.getElementById(`leaderboard-team-score-${team}`);
      this.teamChipElements[team] = document.getElementById(`team-score-chip-${team}`);
    }

    this.healthBarElement = document.getElementById("health-bar-fill");
    this.healthValueElement = document.getElementById("health-value");
    this.armorBarElement = document.getElementById("armor-bar-fill");
    this.armorValueElement = document.getElementById("armor-value");
    this.crosshairElement = document.getElementById("crosshair");
    this.nicknameElement = document.getElementById("nickname-display");
    this.throwableDisplayElement = document.getElementById("throwable-display");
    this.throwableCooldownOverlayElement = document.getElementById(
      "throwable-cooldown-overlay"
    );
    this.throwableIconElement = document.getElementById("throwable-icon");
    this.throwableKindElement = document.getElementById("throwable-kind");
    this.throwableCountElement = document.getElementById("throwable-count");

    // Create weapon slots
    this.createWeaponSlots();

    // Add click event listener to detect shooting when out of ammo
    this.container.addEventListener("mousedown", (event: MouseEvent) => {
      if (event.button === 0) {
        // Left mouse button
        const ammoInfo = this.controls.getAmmoInfo();

        if (ammoInfo.current <= 0 && !ammoInfo.isReloading) {
          if (ammoInfo.total > 0) {
            // Has reserve ammo, show reload message
            this.showEmptyMagIndicator();
          } else {
            // No reserve ammo, show out of ammo message
            this.showNoAmmoIndicator();
          }
        }
      }
    });

    // Add mouse move event listener to track mouse position
    this.container.addEventListener(
      "mousemove",
      this.trackMousePosition.bind(this)
    );

    // Add keyboard event listener to handle weapon dropping
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      // Only process keyboard inputs if controls are enabled
      if (this.controls.isEnabled()) {
        if (event.key.toLowerCase() === "g") {
          // Call dropCurrentWeapon method on controls
          const droppedWeapon = this.controls.dropCurrentWeapon();

          // If a weapon was successfully dropped, show notification
          if (droppedWeapon) {
            this.showWeaponDropNotification(droppedWeapon.name);
          }
        }
      }
    });

    // Death overlay follows the local player's server-driven state
    document.addEventListener("player-death", () => {
      this.showDeathOverlay();
    });
    document.addEventListener("player-respawn", () => {
      this.hideDeathOverlay();
    });

    // Restart button asks the server for a respawn; the overlay hides once it lands
    document.addEventListener("click", (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.id === "restart-button") {
        this.requestRespawn();
      }
    });

    // Server-resolved combat outcomes
    this.net.on(GAME_EVENTS.COMBAT.HIT, ({ shooterId, targetId }) => {
      if (shooterId === this.net.selfId && targetId !== this.net.selfId) {
        sfx.play("hit:marker");
      }
    });
    this.net.on(GAME_EVENTS.COMBAT.KILL, ({ killerId, victimId, teamKill, teamScores, source }) => {
      if (killerId === this.net.selfId && !teamKill) sfx.play("kill");
      this.pushKillFeedRow(killerId, victimId, source, teamKill);
      // The event carries the new totals; the fetch refreshes the per-player rows.
      this.setTeamScores(teamScores);
      this.fetchLeaderboardData();
    });

    // Name + team lookups for the kill feed: the full roster on (re)join, and
    // every roster update the world snapshot carries thereafter.
    this.net.on(GAME_EVENTS.GAME.STATE, ({ players }) => {
      for (const player of players) this.playerInfo.set(player.id, { name: player.name, team: player.team });
    });
    this.net.on(GAME_EVENTS.USER.JOINED, ({ userId, name, team }) => {
      this.playerInfo.set(userId, { name, team });
    });

    // The snapshot's totals are the truth between kills: a round reset zeroes
    // them without any kill event.
    this.net.on(GAME_EVENTS.WORLD.SNAPSHOT, ({ match, players }) => {
      const { blue, red } = match.teamScores;
      if (blue !== this.teamScores.blue || red !== this.teamScores.red) {
        this.setTeamScores(match.teamScores);
      }
      for (const player of players) this.playerInfo.set(player.id, { name: player.name, team: player.team });
    });

    // Set up leaderboard tab key listeners
    if (this.controls.getInputManager) {
      const inputManager = this.controls.getInputManager();
      if (inputManager) {
        inputManager.onShowLeaderboard(() => {
          this.showLeaderboard();
        });

        inputManager.onHideLeaderboard(() => {
          this.hideLeaderboard();
        });
      }
    }

    // Initial leaderboard data
    this.fetchLeaderboardData();
  }

  private createUIOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "ui-overlay";
    overlay.innerHTML = `
     <div class="hud-bottom-bar">
        <!-- Invisible mirror of the throwable slot so the grid's side
             columns stay equal width and the inventory panel (the middle
             column) lands dead-center on screen, regardless of how wide
             the real throwable slot on the right ends up being. -->
        <div class="throwable-display hud-bottom-bar-spacer" aria-hidden="true">
          <div class="throwable-icon-wrapper">
            <svg viewBox="0 0 24 24" width="40" height="40"></svg>
          </div>
          <span class="throwable-key-hint">F</span>
          <span class="throwable-kind">Smoke</span>
        </div>

        <div id="inventory" class="inventory-container">
          <div class="weapon-slots">
            <div id="weapon-slot-0" class="weapon-slot"></div>
            <div id="weapon-slot-1" class="weapon-slot"></div>
            <div id="weapon-slot-2" class="weapon-slot"></div>
          </div>
          <p class="inventory-tip">Press 1-7 to switch weapons, Q/E to cycle, or G to drop</p>
        </div>

        <div id="throwable-display" class="throwable-display ready" title="F throws, C cycles the grenade kind">
          <div class="throwable-icon-wrapper">
            <span id="throwable-icon" class="throwable-icon">${grenadeIcon("frag")}</span>
            <div id="throwable-cooldown-overlay" class="cooldown-overlay"></div>
          </div>
          <span class="throwable-key-hint">F</span>
          <span id="throwable-count" class="throwable-count">×${GRENADE_LOADOUT.frag.start}</span>
          <span id="throwable-kind" class="throwable-kind">${GRENADE_LABELS.frag} <kbd>C</kbd></span>
        </div>
      </div>

      <div class="fps-counter hidden" id="fps">0</div>
      
      <div class="health-container">
        <div class="health-stat hp-stat">
          <div class="health-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div class="health-bar hp-bar">
            <div class="health-bar-fill" id="health-bar-fill"></div>
          </div>
          <div class="health-value" id="health-value">100 HP</div>
        </div>
        <div class="health-stat armor-stat">
          <div class="armor-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
            </svg>
          </div>
          <div class="health-bar armor-bar">
            <div class="armor-bar-fill" id="armor-bar-fill"></div>
          </div>
          <div class="armor-value" id="armor-value">0 ARMOR</div>
        </div>
      </div>
      
      <div class="nickname-display" id="nickname-display">Player</div>

      <!-- Running team score, always visible -->
      <div id="team-score-chip" class="team-score-chip">
        <span class="team-score-chip-label team-blue">Blue</span>
        <span class="team-score-chip-value team-blue" id="team-score-chip-blue">0</span>
        <span class="team-score-chip-separator">:</span>
        <span class="team-score-chip-value team-red" id="team-score-chip-red">0</span>
        <span class="team-score-chip-label team-red">Red</span>
      </div>
      
      <div class="ammo-display">
        <span id="ammo-type" class="ammo-type"></span>
        <span id="current-ammo">0</span>
        <span class="ammo-separator">/</span>
        <span id="total-ammo">0</span>
      </div>

      <div id="reload-indicator" class="reload-indicator hidden">Reloading...</div>
      <div id="empty-mag-indicator" class="empty-mag-indicator hidden">Magazine Empty - Press R to Reload</div>
      <div id="no-ammo-indicator" class="no-ammo-indicator hidden">No Ammo Left!</div>
      

      
      <div id="crosshair" class="crosshair">+</div>

      <!-- Leaderboard -->
      <div id="leaderboard" class="leaderboard hidden">
        <div class="leaderboard-title">
          <svg class="leaderboard-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
            <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
          </svg>
          <span>Leaderboard</span>
        </div>
        <div class="leaderboard-teams">
          <span class="leaderboard-team-name team-blue">Blue</span>
          <span class="leaderboard-team-score team-blue" id="leaderboard-team-score-blue">0</span>
          <span class="leaderboard-team-separator">:</span>
          <span class="leaderboard-team-score team-red" id="leaderboard-team-score-red">0</span>
          <span class="leaderboard-team-name team-red">Red</span>
        </div>
        <div class="leaderboard-content">
          <div class="leaderboard-columns">
            <table class="leaderboard-table team-blue">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Blue</th>
                  <th>Score</th>
                  <th>K</th>
                  <th>D</th>
                </tr>
              </thead>
              <tbody id="leaderboard-body-blue"></tbody>
            </table>
            <table class="leaderboard-table team-red">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Red</th>
                  <th>Score</th>
                  <th>K</th>
                  <th>D</th>
                </tr>
              </thead>
              <tbody id="leaderboard-body-red"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Add notification container -->
      <div id="notification-container" class="notification-container"></div>
      
      <!-- Death overlay -->
      <div id="death-overlay" class="death-overlay hidden">
        <div class="death-message">You Died</div>
        <button id="restart-button" class="restart-button">Restart Game</button>
      </div>
    `;

    // Add CSS for notifications, death overlay and leaderboard
    const style = document.createElement("style");
    style.textContent = `
      /* Top-right feed: kill feed rows plus the occasional pickup/hit toast,
         all sharing the same compact, dark-glass chrome as the rest of the
         HUD (hud-panel-bg-strong, --border, --hud-radius). Capped to
         MAX_VISIBLE_NOTIFICATIONS rows by pushFeedItem, oldest evicted first. */
      .notification-container {
        position: absolute;
        top: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        width: max-content;
        max-width: min(320px, calc(100vw - 40px));
        z-index: 1000;
      }
      
      .notification {
        background-color: var(--hud-panel-bg-strong);
        border: 1px solid var(--border);
        color: var(--text);
        padding: 6px 10px;
        border-radius: var(--hud-radius);
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 100%;
        transform: translateX(16px);
        opacity: 0;
        transition: transform 0.18s ease-out, opacity 0.18s ease-out;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
        border-left: 3px solid var(--accent);
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        pointer-events: none;
      }
      
      .notification.show {
        transform: translateX(0);
        opacity: 1;
      }
      
      .notification-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .notification-icon svg,
      .notification-icon img {
        width: 100%;
        height: 100%;
      }
      
      .notification-content {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      
      .notification-title {
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.02em;
      }
      
      .notification-message {
        font-size: 12px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .notification.health {
        border-left-color: var(--danger);
      }
      
      .notification.ammo {
        border-left-color: var(--accent);
      }
      
      .notification.weapon {
        border-left-color: var(--accent);
      }

      .notification.team-kill {
        border-left-color: var(--danger);
      }

      .notification.team-blue {
        border-left-color: var(--team-blue);
      }

      .notification.team-red {
        border-left-color: var(--team-red);
      }

      /* Kill feed row: "killer [weapon icon] victim", each name colored by
         team, in the style of a Counter-Strike kill feed. */
      .kill-feed-row {
        padding: 5px 10px;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        border-left-color: var(--border-strong);
      }

      /* Friendly fire: flagged the same way the leaderboard flags a
         negative score, so it reads as a penalty rather than a normal kill. */
      .kill-feed-row.team-kill {
        border-left-color: var(--danger);
        background-color: rgba(226, 114, 90, 0.14);
      }

      /* A kill or death involving the local player stands out, same idea as
         the leaderboard's highlight-player row. */
      .kill-feed-row.is-self {
        border-left-color: var(--accent);
        background-color: var(--accent-soft);
      }

      .kill-feed-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 116px;
      }

      .kill-feed-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 16px;
      }

      .kill-feed-icon-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.6));
      }

      .kill-feed-icon svg {
        width: 18px;
        height: 18px;
      }

      .kill-feed-emoji {
        font-size: 14px;
        line-height: 1;
      }
      
      /* Style for empty weapon slots */
      .weapon-icon.empty {
        opacity: 0.6;
        border: 1px dashed rgba(255, 255, 255, 0.3);
      }
      
      .weapon-icon.empty .weapon-name {
        color: rgba(255, 255, 255, 0.6);
      }
      
      .weapon-icon.empty .weapon-ammo {
        color: rgba(255, 255, 255, 0.4);
      }
      
      /* Death overlay styles */
      .death-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(139, 0, 0, 0.7);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 2000;
        pointer-events: auto;
        transition: opacity 1s ease;
      }
      
      .death-overlay.hidden {
        display: none;
        opacity: 0;
      }
      
      .death-message {
        font-size: 64px;
        color: #ffffff;
        margin-bottom: 40px;
        text-shadow: 0 0 10px #000000;
        font-family: Arial, sans-serif;
        font-weight: bold;
      }
      
      .restart-button {
        background-color: #ffffff;
        color: #880000;
        font-size: 24px;
        padding: 15px 30px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.3s ease, transform 0.2s ease;
        font-family: Arial, sans-serif;
        font-weight: bold;
      }
      
      .restart-button:hover {
        background-color: #eeeeee;
        transform: scale(1.05);
      }
      
      .restart-button:active {
        transform: scale(0.95);
      }

      /* Leaderboard styles */
      .leaderboard {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 760px;
        max-width: calc(100vw - 24px);
        background-color: var(--hud-panel-bg-strong);
        border: 1px solid var(--border);
        border-radius: var(--hud-radius);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: var(--text);
        z-index: 1000;
        pointer-events: auto;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        transition: opacity 0.3s ease;
        overflow: hidden;
      }
      
      .leaderboard.hidden {
        display: none;
        opacity: 0;
      }
      
      .leaderboard-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background-color: var(--hud-panel-bg);
        padding: 12px 15px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--accent-strong);
        border-bottom: 1px solid var(--border);
      }
      
      .leaderboard-title-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      /* BLUE  n : m  RED */
      .leaderboard-teams {
        display: flex;
        align-items: baseline;
        justify-content: center;
        gap: 12px;
        padding: 10px 15px;
        border-bottom: 1px solid var(--border);
        font-variant-numeric: tabular-nums;
      }

      .leaderboard-team-name {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .leaderboard-team-score {
        font-size: 28px;
        font-weight: 700;
        line-height: 1;
      }

      .leaderboard-team-separator {
        font-size: 22px;
        color: var(--text-dim);
      }
      
      .leaderboard-content {
        padding: 10px;
        max-height: 380px;
        overflow-y: auto;
      }

      .leaderboard-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        align-items: start;
      }

      @media (max-width: 640px) {
        .leaderboard-columns {
          grid-template-columns: 1fr;
        }
      }

      .leaderboard-table.team-blue th:nth-child(2) {
        color: var(--team-blue);
      }

      .leaderboard-table.team-red th:nth-child(2) {
        color: var(--team-red);
      }

      .leaderboard-table td.leaderboard-empty {
        text-align: center;
        color: var(--text-dim);
        font-style: italic;
      }
      
      .leaderboard-content::-webkit-scrollbar {
        width: 8px;
      }
      
      .leaderboard-content::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .leaderboard-content::-webkit-scrollbar-thumb {
        background: var(--border-strong);
        border-radius: 4px;
      }
      
      .leaderboard-content::-webkit-scrollbar-thumb:hover {
        background: var(--text-dim);
      }
      
      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      
      .leaderboard-table th,
      .leaderboard-table td {
        padding: 8px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border);
      }
      
      .leaderboard-table th {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-dim);
        border-bottom: 1px solid var(--border-strong);
      }
      
      .leaderboard-table th:first-child,
      .leaderboard-table td:first-child {
        text-align: center;
        width: 48px;
      }
      
      .leaderboard-table th:nth-child(n + 3),
      .leaderboard-table td:nth-child(n + 3) {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      
      .leaderboard-table tbody tr:nth-child(even) {
        background-color: var(--hud-panel-alt-bg);
      }
      
      .leaderboard-table tbody tr:hover {
        background-color: var(--accent-soft);
      }
      
      .leaderboard-table tbody tr:last-child td {
        border-bottom: none;
      }
      
      .leaderboard-rank-cell {
        font-weight: 700;
        color: var(--text-muted);
      }
      
      .leaderboard-table tr.rank-1 .leaderboard-rank-cell {
        color: #f1c76a;
      }
      
      .leaderboard-table tr.rank-2 .leaderboard-rank-cell {
        color: #c9ccd4;
      }
      
      .leaderboard-table tr.rank-3 .leaderboard-rank-cell {
        color: #d38a56;
      }
      
      .leaderboard-table td:nth-child(3) {
        color: var(--accent-strong);
        font-weight: 700;
      }

      .leaderboard-table td.leaderboard-negative {
        color: var(--danger);
      }
      
      .highlight-player {
        background-color: var(--accent-soft) !important;
        box-shadow: inset 3px 0 0 var(--accent);
      }
      
      .highlight-player td {
        color: var(--text);
        font-weight: 700;
      }
    `;

    document.head.appendChild(style);
    return overlay;
  }

  private createWeaponSlots() {
    const inventory=this.controls.getInventory();
    const container=this.container.querySelector('.weapon-slots');
    if(!container)return;
    while(this.weaponSlots.length<inventory.length) {
      const i=this.weaponSlots.length;
      const slot=document.getElementById(`weapon-slot-${i}`)??document.createElement('div');
      slot.id=`weapon-slot-${i}`;slot.className='weapon-slot';container.append(slot);
      slot.addEventListener('click',()=>this.controls.switchToWeapon(i));this.weaponSlots.push(slot);
    }
  }

  private showEmptyMagIndicator(): void {
    if (this.emptyMagElement) {
      // Hide the empty mag indicator if we're reloading
      const ammoInfo = this.controls.getAmmoInfo();
      if (ammoInfo.isReloading) {
        this.emptyMagElement.classList.add("hidden");
        return;
      }

      this.emptyMagElement.classList.remove("hidden");

      // Clear any existing timeout
      if (this.emptyMagTimeout !== null) {
        window.clearTimeout(this.emptyMagTimeout);
      }

      // Hide the message after 1.5 seconds
      this.emptyMagTimeout = window.setTimeout(() => {
        if (this.emptyMagElement) {
          this.emptyMagElement.classList.add("hidden");
        }
        this.emptyMagTimeout = null;
      }, 1500);
    }
  }

  private showNoAmmoIndicator(): void {
    if (this.noAmmoElement) {
      this.noAmmoElement.classList.remove("hidden");

      // Clear any existing timeout
      if (this.noAmmoTimeout !== null) {
        window.clearTimeout(this.noAmmoTimeout);
      }

      // Hide the message after 1.5 seconds
      this.noAmmoTimeout = window.setTimeout(() => {
        if (this.noAmmoElement) {
          this.noAmmoElement.classList.add("hidden");
        }
        this.noAmmoTimeout = null;
      }, 1500);
    }
  }

  // Track mouse position but don't update DOM directly
  private trackMousePosition(event: MouseEvent): void {
    this.mouseX = event.clientX;
    this.mouseY = event.clientY;
    this.isMousePositionDirty = true;
  }

  // Update crosshair position in the update loop instead of in the event handler
  private updateCrosshairPosition(): void {
    if (this.crosshairElement && this.isMousePositionDirty) {
      // Use transform instead of setting top/left for better performance
      this.crosshairElement.style.transform = `translate(${this.mouseX}px, ${this.mouseY}px) translate(-50%, -50%)`;
      this.isMousePositionDirty = false;
    }
  }

  public update(): void {
    this.updateFPS();
    this.updateAmmoDisplay();
    this.updateInventoryDisplay();
    this.updateHealthDisplay();
    this.updateThrowableDisplay();
    this.updateCrosshairPosition(); // Update crosshair in main loop
  }

  /**
   * Dev-only readout: visible in local dev builds, or in production once
   * debug mode (B) is toggled on. Hidden otherwise.
   */
  private updateFPS(): void {
    if (this.fpsElement) {
      const shouldShow = import.meta.env.DEV || this.controls.isDebugMode();
      this.fpsElement.classList.toggle("hidden", !shouldShow);
    }

    this.frameCount++;
    const currentTime = performance.now();

    if (currentTime - this.lastTime >= 1000) {
      const fps = Math.round(
        (this.frameCount * 1000) / (currentTime - this.lastTime)
      );

      if (this.fpsElement) {
        this.fpsElement.textContent = fps.toString();
      }

      this.frameCount = 0;
      this.lastTime = currentTime;
    }
  }

  private updateAmmoDisplay(): void {
    const ammoInfo = this.controls.getAmmoInfo();
    const label = document.getElementById("ammo-type");
    if(label)label.textContent=ammoInfo.ammoType;

    if (this.currentAmmoElement) {
      if (ammoInfo.isEmpty) {
        this.currentAmmoElement.textContent = "-";
      } else {
        this.currentAmmoElement.textContent = ammoInfo.current.toString();
      }
    }

    if (this.totalAmmoElement) {
      if (ammoInfo.isEmpty) {
        this.totalAmmoElement.textContent = "-";
      } else {
        this.totalAmmoElement.textContent = ammoInfo.total.toString();
      }
    }

    if (this.reloadIndicatorElement) {
      if (ammoInfo.isReloading) {
        this.reloadIndicatorElement.classList.remove("hidden");
        // Also ensure empty mag indicator is hidden while reloading
        if (this.emptyMagElement) {
          this.emptyMagElement.classList.add("hidden");
        }
        if (this.noAmmoElement) {
          this.noAmmoElement.classList.add("hidden");
        }
      } else {
        this.reloadIndicatorElement.classList.add("hidden");
      }
    }
  }

  /** Reflect the selected grenade kind and throw cooldown in the throwables HUD slot. */
  private updateThrowableDisplay(): void {
    if (!this.throwableDisplayElement || !this.throwableCooldownOverlayElement) return;

    const grenadeInfo = this.controls.getGrenadeInfo();
    if (grenadeInfo.kind !== this.throwableKindShown) {
      this.throwableKindShown = grenadeInfo.kind;
      if (this.throwableIconElement) this.throwableIconElement.innerHTML = grenadeIcon(grenadeInfo.kind);
      if (this.throwableKindElement) {
        this.throwableKindElement.innerHTML = `${GRENADE_LABELS[grenadeInfo.kind]} <kbd>C</kbd>`;
      }
    }
    if (grenadeInfo.count !== this.throwableCountShown) {
      this.throwableCountShown = grenadeInfo.count;
      if (this.throwableCountElement) this.throwableCountElement.textContent = `×${grenadeInfo.count}`;
    }
    const percentRemaining =
      grenadeInfo.cooldownDuration > 0
        ? (grenadeInfo.cooldownRemaining / grenadeInfo.cooldownDuration) * 100
        : 0;

    this.throwableCooldownOverlayElement.style.height = `${percentRemaining}%`;
    this.throwableDisplayElement.classList.toggle(
      "ready",
      grenadeInfo.isReady
    );
    this.throwableDisplayElement.classList.toggle("empty", grenadeInfo.count <= 0);
  }

  private updateInventoryDisplay(): void {
    this.createWeaponSlots();
    // Get inventory from controls
    const inventory = this.controls.getInventory();
    const currentWeaponIndex = this.controls.getCurrentWeaponIndex();

    // Update each weapon slot
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const slotElement = this.weaponSlots[i];
      if (slotElement && i < inventory.length) {
        const weapon = inventory[i];
        const selected = i === currentWeaponIndex;
        let state = this.weaponSlotStates[i];
        if (!state || state.identity !== weapon.id) {
          state = this.createWeaponSlotContent(slotElement, weapon, selected);
          this.weaponSlotStates[i] = state;
        }

        const title = `${i+1} — ${weapon.id ? WEAPONS[weapon.id].ammoType : "Empty"}`;
        if (slotElement.title !== title) {
          slotElement.title = title;
        }

        if (state.selected !== selected) {
          state.iconElement.classList.toggle("selected", selected);
          state.selected = selected;
        }

        const ammo = weapon.name === "Empty"
          ? "-/-"
          : `${weapon.bulletsInMagazine}/${weapon.totalBullets}`;
        if (state.ammoElement.textContent !== ammo) {
          state.ammoElement.textContent = ammo;
        }

        if (state.reloadOverlayElement) {
          const height = `${this.getReloadOverlayPercent(weapon)}%`;
          if (state.reloadOverlayElement.style.height !== height) {
            state.reloadOverlayElement.style.height = height;
          }
        }
      }
    }
  }

  private createWeaponSlotContent(
    slotElement: HTMLElement,
    weapon: Weapon,
    selected: boolean
  ): WeaponSlotState {
    if (weapon.name === "Empty") {
      slotElement.innerHTML = `
        <div class="weapon-icon empty ${selected ? "selected" : ""}">
          <div class="weapon-image">
            <svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
              <rect x="30" y="15" width="40" height="10" fill="#444" fill-opacity="0.3" />
              <text x="50" y="25" text-anchor="middle" fill="#fff" font-size="10">Empty</text>
            </svg>
          </div>
          <span class="weapon-name">Empty Slot</span>
          <span class="weapon-ammo">-/-</span>
        </div>
      `;
    } else {
      const weaponIcon = this.getWeaponIcon(weapon.name);
      const reloadOverlayPercent = this.getReloadOverlayPercent(weapon);

      slotElement.innerHTML = `
        <div class="weapon-icon ${selected ? "selected" : ""}">
          <div class="weapon-image">
            ${weaponIcon}
            <div class="cooldown-overlay" style="height: ${reloadOverlayPercent}%"></div>
          </div>
          <span class="weapon-name">${weapon.name}</span>
          <span class="weapon-ammo">${weapon.bulletsInMagazine}/${weapon.totalBullets}</span>
        </div>
      `;
    }

    return {
      identity: weapon.id,
      selected,
      iconElement: slotElement.querySelector<HTMLElement>(".weapon-icon")!,
      ammoElement: slotElement.querySelector<HTMLElement>(".weapon-ammo")!,
      reloadOverlayElement: slotElement.querySelector<HTMLElement>(".cooldown-overlay"),
    };
  }

  /**
   * Percent of the weapon-slot icon still covered by the reload overlay:
   * 100% the instant reload starts, draining to 0% as it completes - the
   * same "fill drains as it becomes ready" look as the throwable slot's
   * cooldown overlay.
   */
  private getReloadOverlayPercent(weapon: Weapon): number {
    if (!weapon.isReloading || weapon.reloadTime <= 0) return 0;

    const elapsedSeconds = (performance.now() - weapon.reloadStartTime) / 1000;
    const progress = Math.min(1, Math.max(0, elapsedSeconds / weapon.reloadTime));
    return (1 - progress) * 100;
  }

  private updateHealthDisplay(): void {
    const healthInfo = this.controls.getHealth();
    const healthPercent = (healthInfo.current / healthInfo.max) * 100;

    if (this.healthBarElement) {
      this.healthBarElement.style.width = `${healthPercent}%`;
      this.healthBarElement.classList.toggle("medium", healthPercent <= 60 && healthPercent > 30);
      this.healthBarElement.classList.toggle("low", healthPercent <= 30);
    }

    if (this.healthValueElement) {
      const currentHealth = Math.ceil(healthInfo.current);
      this.healthValueElement.textContent = `${currentHealth} HP`;
    }

    const playerController = this.controls.getPlayerController();
    const armor = playerController.getArmor();
    const armorPercent = (armor / playerController.getMaxArmor()) * 100;

    if (this.armorBarElement) {
      this.armorBarElement.style.width = `${armorPercent}%`;
    }

    if (this.armorValueElement) {
      this.armorValueElement.textContent = `${Math.ceil(armor)} ARMOR`;
    }

    // Optional: Add visual effects when health is low
    if (healthInfo.current < 30) {
      document.body.classList.add("low-health");
    } else {
      document.body.classList.remove("low-health");
    }
  }

  // Pre-rendered icons (assets/blender, see model-noir-weapons.py) of the
  // actual in-game weapon models, isolated on a transparent background.
  private getWeaponIcon(weaponName: string): string {
    const extra=Object.values(WEAPONS).find(w=>w.name===weaponName && ['rocket','flamethrower','precision','arc'].includes(w.id));
    if(extra)return `<img src="/icons/noir-${extra.id}.png" alt="${extra.name}" />`;
    switch (weaponName) {
      case "Pistol":
        return `<img src="/icons/noir-pistol.png" alt="Pistol" />`;
      case "Assault Rifle":
        return `<img src="/icons/noir-rifle.png" alt="Assault Rifle" />`;
      case "Shotgun":
        return `<img src="/icons/noir-shotgun.png" alt="Shotgun" />`;
      case "Empty":
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <rect x="30" y="15" width="40" height="10" fill="#444" fill-opacity="0.3" />
          <text x="50" y="25" text-anchor="middle" fill="#fff" font-size="10">Empty</text>
        </svg>`;
      default:
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <rect x="30" y="15" width="40" height="10" fill="#999" />
        </svg>`;
    }
  }

  /**
   * Show a notification when a player picks up a health item
   */
  public showHealthPickupNotification(amount: number): void {
    this.showNotification(
      "health",
      "Health Pickup",
      `+${amount} health`,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#ff4444">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-3 12h-3v3h-2v-3H8v-2h3V7h2v6h3v2z"/>
        </svg>
      `
    );
  }

  /**
   * Show a notification when a player picks up ammo
   */
  public showAmmoPickupNotification(
    weaponType: WeaponType,
    amount: number
  ): void {
    const weaponName = this.getWeaponNameFromType(weaponType);

    this.showNotification(
      "ammo",
      "Ammo Pickup",
      `+${amount} ${weaponName} ammo`,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#cccc00">
          <path d="M7 15h10v2H7v-2zm12-6h-4.5V4l-5 5-5-5v5H0v2h4.5v5l5-5 5 5V9H19V9z"/>
        </svg>
      `
    );
  }

  /** Show a notification when the player picks up throwables of one kind. */
  public showThrowablePickupNotification(kind: GrenadeKind, amount: number): void {
    this.showNotification(
      "throwable",
      "Throwable Pickup",
      `+${amount} ${GRENADE_LABELS[kind]}`,
      grenadeIcon(kind)
    );
  }

  /**
   * Show a notification when a player picks up a weapon
   */
  public showWeaponPickupNotification(weaponName: string): void {
    this.showNotification(
      "weapon",
      "Weapon Pickup",
      `Picked up ${weaponName}`,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#d6a15f">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" transform="rotate(180, 12, 12)"/>
        </svg>
      `
    );
  }

  /**
   * Show a notification when a player drops a weapon
   */
  public showWeaponDropNotification(weaponName: string): void {
    this.showNotification(
      "weapon",
      "Weapon Dropped",
      `${weaponName} was dropped`,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#d6a15f">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
      `
    );
  }

  /**
   * Show a generic notification
   */
  public showNotification(
    type: string,
    title: string,
    message: string,
    iconSvg: string,
    duration = 3000
  ): void {
    if (!this.notificationContainer) return;

    const notificationEl = document.createElement("div");
    notificationEl.className = `notification ${type}`;
    notificationEl.innerHTML = `
      <div class="notification-icon">${iconSvg}</div>
      <div class="notification-content">
        <div class="notification-title"></div>
        <div class="notification-message"></div>
      </div>
    `;
    notificationEl.querySelector(".notification-title")!.textContent = title;
    notificationEl.querySelector(".notification-message")!.textContent = message;

    this.pushFeedItem(notificationEl, `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`, duration);
  }

  /**
   * Show a Counter-Strike-style kill feed row: `killer [weapon] victim`,
   * both names colored by team. Self-inflicted and world-hazard deaths
   * (no credited player) collapse to a single "victim" entry with a skull
   * or hazard glyph instead of a killer name.
   */
  private pushKillFeedRow(
    killerId: string,
    victimId: string,
    source: DamageSource,
    teamKill: boolean
  ): void {
    const victim = this.playerInfo.get(victimId);
    const victimName = victim?.name ?? "Unknown";
    const victimColor = this.teamColorVar(victim?.team ?? null);

    // The car hazard's "shooter" is the car's own object id, not a player;
    // dying to your own grenade/rocket/barrel is a suicide either way.
    const environmental = source === "car";
    const suicide = !environmental && killerId === victimId;

    const row = document.createElement("div");
    row.className = "notification kill-feed-row";
    if (teamKill) row.classList.add("team-kill");
    if (killerId === this.net.selfId || victimId === this.net.selfId) row.classList.add("is-self");

    if (environmental || suicide) {
      row.innerHTML = `
        <span class="kill-feed-icon kill-feed-emoji">${environmental ? "🚗" : "💀"}</span>
        <span class="kill-feed-name" data-role="victim" style="color:${victimColor}"></span>
      `;
    } else {
      const killer = this.playerInfo.get(killerId);
      const killerName = killer?.name ?? "Unknown";
      const killerColor = this.teamColorVar(killer?.team ?? null);
      row.innerHTML = `
        <span class="kill-feed-name" data-role="killer" style="color:${killerColor}"></span>
        <span class="kill-feed-icon">${this.killFeedIcon(source)}</span>
        <span class="kill-feed-name" data-role="victim" style="color:${victimColor}"></span>
      `;
      row.querySelector('[data-role="killer"]')!.textContent = killerName;
    }
    row.querySelector('[data-role="victim"]')!.textContent = victimName;

    this.pushFeedItem(row, `kill-${killerId}-${victimId}-${Date.now()}`, 5000);
  }

  /** Small icon markup for a kill feed row: the actual weapon icon for guns, a themed glyph otherwise. */
  private killFeedIcon(source: DamageSource): string {
    if (isWeaponId(source)) {
      return `<img class="kill-feed-icon-img" src="/icons/noir-${source}.png" alt="${source}" />`;
    }
    switch (source) {
      case "grenade":
        return grenadeIcon("frag");
      case "gas":
        return grenadeIcon("gas");
      case "fire":
        return grenadeIcon("molotov");
      case "barrel":
        return `<span class="kill-feed-emoji">💥</span>`;
      case "car":
        return `<span class="kill-feed-emoji">🚗</span>`;
      default: {
        const unhandled: never = source;
        throw new Error(`Unhandled damage source: ${String(unhandled)}`);
      }
    }
  }

  /** Team color as a CSS `var()` reference, so it can be dropped straight into an inline style. */
  private teamColorVar(team: Team | null): string {
    if (team === "blue") return "var(--team-blue)";
    if (team === "red") return "var(--team-red)";
    return "var(--text-dim)";
  }

  /**
   * Add one row to the top-right feed, animate it in, and schedule its
   * removal. Enforces `MAX_VISIBLE_NOTIFICATIONS` by evicting the oldest
   * row(s) immediately, so the feed never grows unbounded during a heavy
   * exchange of kills.
   */
  private pushFeedItem(element: HTMLElement, id: string, duration: number): void {
    if (!this.notificationContainer) return;

    element.id = id;
    this.notificationContainer.appendChild(element);
    this.notificationOrder.push(id);

    // Delay so the browser registers the initial (offscreen) state before
    // the "show" class triggers the slide/fade-in transition.
    requestAnimationFrame(() => element.classList.add("show"));

    const timeoutId = window.setTimeout(() => this.dismissNotification(id), duration);
    this.activeNotifications.set(id, { element, timeoutId });

    while (this.notificationOrder.length > HUD.MAX_VISIBLE_NOTIFICATIONS) {
      const oldestId = this.notificationOrder[0];
      if (oldestId === id) break; // guard against an unexpected infinite loop
      this.dismissNotification(oldestId);
    }
  }

  /** Fade a notification out and remove it from the DOM once the transition finishes. */
  private dismissNotification(id: string): void {
    const entry = this.activeNotifications.get(id);
    if (!entry) return;

    window.clearTimeout(entry.timeoutId);
    entry.element.classList.remove("show");
    this.activeNotifications.delete(id);
    this.notificationOrder = this.notificationOrder.filter((existingId) => existingId !== id);

    window.setTimeout(() => {
      entry.element.parentNode?.removeChild(entry.element);
    }, 300);
  }

  /**
   * Get weapon name from weapon type
   */
  private getWeaponNameFromType(weaponType: WeaponType): string { return WEAPONS[weaponType].ammoType; }

  /**
   * Show the death overlay
   */
  private showDeathOverlay(): void {
    if (this.deathOverlay) {
      this.deathOverlay.classList.remove("hidden");
    }
  }

  /**
   * Hide the death overlay (also called when the round-end board takes over)
   */
  public hideDeathOverlay(): void {
    if (this.deathOverlay) {
      this.deathOverlay.classList.add("hidden");
    }
  }

  private requestRespawn(): void {
    this.controls.getPlayerController()?.requestRespawn();
  }

  /**
   * Update the player's nickname display
   * @param nickname The player's nickname
   */
  public updateNickname(nickname: string): void {
    if (this.nicknameElement) {
      this.nicknameElement.textContent = nickname;
    }
  }

  /**
   * Fetch leaderboard data from the server
   */
  private async fetchLeaderboardData(): Promise<void> {
    try {
      const data = await this.net.getLeaderboard();
      this.leaderboardData = Object.values(data.players);
      this.setTeamScores(data.teams);
    } catch (error) {
      console.error("Error fetching leaderboard data:", error);
      this.leaderboardData = [];
    }
    if (this.leaderboardVisible) {
      this.updateLeaderboardDisplay();
    }
  }

  /** Show the running team totals in the chip and the leaderboard header. */
  private setTeamScores(scores: TeamScores): void {
    this.teamScores = { ...scores };
    for (const team of TEAMS) {
      const value = String(scores[team]);
      const chip = this.teamChipElements[team];
      if (chip) chip.textContent = value;
      const header = this.teamScoreElements[team];
      if (header) header.textContent = value;
    }
  }

  /** Tell the player which side they are on; called on every (re)join. */
  public showTeamAssigned(team: Team): void {
    this.showNotification(
      `team-${team}`,
      `You are on ${TEAM_LABEL[team].toUpperCase()}`,
      `Spawn street: ${team === "blue" ? "south" : "north"}. Watch your fire near teammates.`,
      team === "blue" ? "🔵" : "🔴",
      5000
    );
  }

  /**
   * Update the leaderboard display with current data
   */
  private updateLeaderboardDisplay(): void {
    if (!this.leaderboardElement) return;

    const selfId = this.net.selfId;
    for (const team of TEAMS) {
      const body = document.getElementById(`leaderboard-body-${team}`);
      if (body) renderTeamTable(body, this.leaderboardData, team, selfId);
    }
  }

  /**
   * Show the leaderboard
   */
  public showLeaderboard(): void {
    if (!this.leaderboardElement) return;

    // Fetch latest data
    this.fetchLeaderboardData();

    // Show the leaderboard
    this.leaderboardElement.classList.remove("hidden");
    this.leaderboardVisible = true;

    // Start auto-updating the leaderboard
    if (this.leaderboardUpdateInterval === null) {
      this.leaderboardUpdateInterval = window.setInterval(() => {
        this.fetchLeaderboardData();
      }, 3000); // Update every 3 seconds
    }
  }

  /**
   * Hide the leaderboard
   */
  public hideLeaderboard(): void {
    if (!this.leaderboardElement) return;

    // Hide the leaderboard
    this.leaderboardElement.classList.add("hidden");
    this.leaderboardVisible = false;

    // Stop auto-updating
    if (this.leaderboardUpdateInterval !== null) {
      window.clearInterval(this.leaderboardUpdateInterval);
      this.leaderboardUpdateInterval = null;
    }
  }
}
