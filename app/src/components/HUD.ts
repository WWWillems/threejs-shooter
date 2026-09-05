import type { IsometricControls } from "./IsometricControls";
import { WeaponType } from "./Weapon";
import type { NetworkClient } from "../net/NetworkClient";
import { GAME_EVENTS, type LeaderboardEntry } from "@threejs-shooter/shared";

type LeaderboardPlayer = LeaderboardEntry;

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
  // Death overlay
  private deathOverlay: HTMLElement | null = null;
  private leaderboardElement: HTMLElement | null = null;
  private leaderboardVisible = false;
  private leaderboardData: LeaderboardPlayer[] = [];
  private leaderboardUpdateInterval: number | null = null;

  private weaponSlots: HTMLElement[] = [];
  private healthBarElement: HTMLElement | null = null;
  private healthValueElement: HTMLElement | null = null;
  private crosshairElement: HTMLElement | null = null;
  private nicknameElement: HTMLElement | null = null;

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

    this.healthBarElement = document.getElementById("health-bar-fill");
    this.healthValueElement = document.getElementById("health-value");
    this.crosshairElement = document.getElementById("crosshair");
    this.nicknameElement = document.getElementById("nickname-display");

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
    this.net.on(GAME_EVENTS.COMBAT.HIT, ({ shooterId, targetId, damage }) => {
      if (shooterId === this.net.selfId && targetId !== this.net.selfId) {
        this.showNotification(
          `damage-${targetId}`,
          "Player Hit",
          `Dealt ${damage} damage`,
          "💥"
        );
      }
    });
    this.net.on(GAME_EVENTS.COMBAT.KILL, ({ killerId, victimId }) => {
      if (killerId === this.net.selfId) {
        this.showNotification("kill", "Kill", "You eliminated a player", "🎯");
      } else if (victimId === this.net.selfId) {
        this.showNotification("death", "Killed", "You were eliminated", "💀");
      }
      this.fetchLeaderboardData();
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
     <div id="inventory" class="inventory-container" style="position: absolute; bottom: 10px; left: 0; right: 0; margin: 0 auto; width: 400px; background: rgba(0, 0, 0, 0.6); padding: 15px; border-radius: 5px; text-align: center; pointer-events: auto;">
        <h3>Inventory</h3>
        <div class="weapon-slots">
          <div id="weapon-slot-0" class="weapon-slot"></div>
          <div id="weapon-slot-1" class="weapon-slot"></div>
          <div id="weapon-slot-2" class="weapon-slot"></div>
        </div>
        <p class="inventory-tip">Press 1-3 to switch weapons, Q/E to cycle, or G to drop</p>
      </div>

      <div class="fps-counter" id="fps">FPS: 0</div>
      
      <div class="health-container">
        <div class="health-bar">
          <div class="health-bar-fill" id="health-bar-fill"></div>
        </div>
        <div class="health-value" id="health-value">100</div>
      </div>
      
      <div class="nickname-display" id="nickname-display">Player</div>
      
      <div class="ammo-display">
        <span id="current-ammo">0</span>
        <span class="ammo-separator">/</span>
        <span id="total-ammo">0</span>
      </div>
      
      <div id="reload-indicator" class="reload-indicator hidden">Reloading...</div>
      <div id="empty-mag-indicator" class="empty-mag-indicator hidden">Magazine Empty - Press R to Reload</div>
      <div id="no-ammo-indicator" class="no-ammo-indicator hidden">No Ammo Left!</div>
      
      <div class="inventory" id="inventory"></div>
      
      <div id="crosshair" class="crosshair">+</div>

      <!-- Leaderboard -->
      <div id="leaderboard" class="leaderboard hidden">
        <div class="leaderboard-title">Leaderboard</div>
        <div class="leaderboard-content">
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Score</th>
                <th>Kills</th>
              </tr>
            </thead>
            <tbody id="leaderboard-body">
              <!-- Leaderboard data will be inserted here -->
            </tbody>
          </table>
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
      .notification-container {
        position: absolute;
        top: 20px;
        right: 20px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        max-width: 300px;
        z-index: 1000;
      }
      
      .notification {
        background-color: rgba(0, 0, 0, 0.75);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        transform: translateX(100%);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        border-left: 4px solid #4a90e2;
        font-family: Arial, sans-serif;
        pointer-events: none;
      }
      
      .notification.show {
        transform: translateX(0);
        opacity: 1;
      }
      
      .notification-icon {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .notification-content {
        display: flex;
        flex-direction: column;
      }
      
      .notification-title {
        font-weight: bold;
        margin-bottom: 2px;
      }
      
      .notification-message {
        font-size: 14px;
        opacity: 0.9;
      }
      
      .notification.health {
        border-left-color: #ff4444;
      }
      
      .notification.ammo {
        border-left-color: #cccc00;
      }
      
      .notification.weapon {
        border-left-color: #3399ff;
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
        width: 600px;
        background-color: rgba(0, 0, 0, 0.8);
        border-radius: 8px;
        color: white;
        z-index: 1000;
        pointer-events: auto;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
        transition: opacity 0.3s ease;
      }
      
      .leaderboard.hidden {
        display: none;
        opacity: 0;
      }
      
      .leaderboard-title {
        background-color: rgba(50, 50, 80, 0.8);
        padding: 15px;
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
        border-bottom: 2px solid rgba(255, 255, 255, 0.2);
      }
      
      .leaderboard-content {
        padding: 15px;
        max-height: 400px;
        overflow-y: auto;
      }
      
      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
      }
      
      .leaderboard-table th,
      .leaderboard-table td {
        padding: 10px;
        text-align: left;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .leaderboard-table th {
        background-color: rgba(60, 60, 100, 0.5);
        color: rgba(255, 255, 255, 0.9);
        font-weight: bold;
      }
      
      .leaderboard-table tbody tr:nth-child(odd) {
        background-color: rgba(40, 40, 60, 0.5);
      }
      
      .leaderboard-table tbody tr:nth-child(even) {
        background-color: rgba(50, 50, 70, 0.5);
      }
      
      .leaderboard-table tbody tr:hover {
        background-color: rgba(80, 80, 120, 0.5);
      }
      
      .highlight-player {
        background-color: rgba(100, 150, 255, 0.3) !important;
        font-weight: bold;
      }
    `;

    document.head.appendChild(style);
    return overlay;
  }

  private createWeaponSlots() {
    // Get inventory from controls
    const inventory = this.controls.getInventory();
    const currentWeaponIndex = this.controls.getCurrentWeaponIndex();

    // Create weapon slots
    for (let i = 0; i < 3; i++) {
      const slotElement = document.getElementById(`weapon-slot-${i}`);
      if (slotElement) {
        // Save reference to slot
        this.weaponSlots[i] = slotElement;

        // Create slot content
        if (i < inventory.length) {
          const weapon = inventory[i];
          // Get the appropriate weapon icon
          const weaponIcon = this.getWeaponIcon(weapon.name);

          slotElement.innerHTML = `
            <div class="weapon-icon ${
              i === currentWeaponIndex ? "selected" : ""
            }">
              <div class="weapon-image">${weaponIcon}</div>
              <span class="weapon-name">${weapon.name}</span>
              <span class="weapon-ammo">${weapon.bulletsInMagazine}/${
            weapon.totalBullets
          }</span>
            </div>
          `;
        }

        // Add click handler for slot
        slotElement.addEventListener("click", () => {
          // Only allow switching to valid weapons
          if (i < inventory.length) {
            // Switch weapon using the public method
            this.controls.switchToWeapon(i);
          }
        });
      }
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
    this.updateCrosshairPosition(); // Update crosshair in main loop
  }

  private updateFPS(): void {
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

  private updateInventoryDisplay(): void {
    // Get inventory from controls
    const inventory = this.controls.getInventory();
    const currentWeaponIndex = this.controls.getCurrentWeaponIndex();

    // Update each weapon slot
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const slotElement = this.weaponSlots[i];
      if (slotElement && i < inventory.length) {
        const weapon = inventory[i];

        // Check if weapon slot is empty
        if (weapon.name === "Empty") {
          slotElement.innerHTML = `
            <div class="weapon-icon empty ${
              i === currentWeaponIndex ? "selected" : ""
            }">
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
          // Get the appropriate weapon icon for non-empty slots
          const weaponIcon = this.getWeaponIcon(weapon.name);

          slotElement.innerHTML = `
            <div class="weapon-icon ${
              i === currentWeaponIndex ? "selected" : ""
            }">
              <div class="weapon-image">${weaponIcon}</div>
              <span class="weapon-name">${weapon.name}</span>
              <span class="weapon-ammo">${weapon.bulletsInMagazine}/${
            weapon.totalBullets
          }</span>
            </div>
          `;
        }
      }
    }
  }

  private updateHealthDisplay(): void {
    const healthInfo = this.controls.getHealth();

    if (this.healthBarElement) {
      const healthPercent = (healthInfo.current / healthInfo.max) * 100;
      this.healthBarElement.style.width = `${healthPercent}%`;

      // Change color based on health level
      if (healthPercent > 60) {
        this.healthBarElement.style.backgroundColor = "#44ff44"; // Green
      } else if (healthPercent > 30) {
        this.healthBarElement.style.backgroundColor = "#ffff44"; // Yellow
      } else {
        this.healthBarElement.style.backgroundColor = "#ff4444"; // Red
      }
    }

    if (this.healthValueElement) {
      const currentHealth = Math.ceil(healthInfo.current);
      this.healthValueElement.textContent = `${currentHealth} / ${healthInfo.max} HP`;
    }

    // Optional: Add visual effects when health is low
    if (healthInfo.current < 30) {
      document.body.classList.add("low-health");
    } else {
      document.body.classList.remove("low-health");
    }
  }

  // Helper method to get SVG icon for each weapon type
  private getWeaponIcon(weaponName: string): string {
    switch (weaponName) {
      case "Pistol":
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <!-- Barrel -->
          <rect x="60" y="17" width="35" height="6" rx="1" fill="#555" />
          <!-- Frame -->
          <rect x="20" y="15" width="40" height="10" rx="2" fill="#777" />
          <!-- Trigger guard -->
          <path d="M25,25 L45,25 L45,35 L35,35 Z" fill="#555" />
          <!-- Handle/Grip -->
          <rect x="15" y="23" width="15" height="15" rx="2" fill="#666" transform="rotate(-5, 15, 25)" />
          <!-- Hammer -->
          <rect x="22" y="13" width="5" height="5" rx="1" fill="#444" />
          <!-- Sight -->
          <rect x="55" y="13" width="3" height="2" fill="#444" />
        </svg>`;
      case "Assault Rifle":
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <!-- Barrel -->
          <rect x="70" y="17" width="30" height="4" rx="1" fill="#555" />
          <!-- Suppressor -->
          <rect x="90" y="16" width="10" height="6" rx="2" fill="#444" />
          <!-- Frame -->
          <rect x="15" y="15" width="55" height="8" rx="1" fill="#777" />
          <!-- Stock -->
          <rect x="0" y="15" width="17" height="8" rx="2" fill="#666" />
          <!-- Magazine -->
          <rect x="40" y="23" width="10" height="15" rx="1" fill="#555" />
          <!-- Grip -->
          <rect x="25" y="23" width="8" height="12" rx="1" fill="#666" transform="rotate(-5, 25, 23)" />
          <!-- Sight -->
          <rect x="60" y="12" width="10" height="3" rx="1" fill="#444" />
          <rect x="64" y="9" width="2" height="3" fill="#333" />
        </svg>`;
      case "Shotgun":
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <!-- Double Barrels -->
          <rect x="60" y="12" width="40" height="6" rx="2" fill="#555" />
          <rect x="60" y="22" width="40" height="6" rx="2" fill="#555" />
          <!-- Receiver -->
          <rect x="30" y="10" width="30" height="20" rx="1" fill="#8b4513" />
          <!-- Fore-end -->
          <rect x="15" y="10" width="15" height="20" rx="2" fill="#a67b5b" />
          <!-- Stock -->
          <path d="M0,15 L15,15 L15,25 L10,30 L0,30 Z" fill="#8b4513" />
          <!-- Trigger guard -->
          <path d="M30,30 L45,30 L45,35 L35,35 Z" fill="#614126" />
        </svg>`;
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

  /**
   * Show a notification when a player picks up a weapon
   */
  public showWeaponPickupNotification(weaponName: string): void {
    this.showNotification(
      "weapon",
      "Weapon Pickup",
      `Picked up ${weaponName}`,
      `
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#3399ff">
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
        <svg viewBox="0 0 24 24" width="24" height="24" fill="#3399ff">
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

    // Create notification element
    const notificationId = `notification-${Date.now()}`;
    const notificationEl = document.createElement("div");
    notificationEl.className = `notification ${type}`;
    notificationEl.id = notificationId;
    notificationEl.innerHTML = `
      <div class="notification-icon">${iconSvg}</div>
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        <div class="notification-message">${message}</div>
      </div>
    `;

    // Add to container
    this.notificationContainer.appendChild(notificationEl);

    // Trigger animation (need to delay it for the browser to process the DOM change)
    setTimeout(() => {
      notificationEl.classList.add("show");
    }, 10);

    // Create timeout to remove notification
    const timeoutId = window.setTimeout(() => {
      notificationEl.classList.remove("show");

      // Remove from DOM after animation completes
      setTimeout(() => {
        if (notificationEl.parentNode) {
          notificationEl.parentNode.removeChild(notificationEl);
        }
        this.activeNotifications.delete(notificationId);
      }, 300);
    }, duration);

    // Store active notification
    this.activeNotifications.set(notificationId, {
      element: notificationEl,
      timeoutId,
    });
  }

  /**
   * Get weapon name from weapon type
   */
  private getWeaponNameFromType(weaponType: WeaponType): string {
    switch (weaponType) {
      case WeaponType.PISTOL:
        return "Pistol";
      case WeaponType.RIFLE:
        return "Assault Rifle";
      case WeaponType.SHOTGUN:
        return "Shotgun";
      default: {
        const unhandled: never = weaponType;
        return unhandled;
      }
    }
  }

  /**
   * Show the death overlay
   */
  private showDeathOverlay(): void {
    if (this.deathOverlay) {
      this.deathOverlay.classList.remove("hidden");
    }
  }

  /**
   * Hide the death overlay
   */
  private hideDeathOverlay(): void {
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
      this.leaderboardData = Object.values(data);

      // Update the leaderboard display if it's visible
      if (this.leaderboardVisible) {
        this.updateLeaderboardDisplay();
      }
    } catch (error) {
      console.error("Error fetching leaderboard data:", error);
      // Set leaderboardData to empty array on error to prevent forEach issues
      this.leaderboardData = [];

      // Still update the display to show empty leaderboard
      if (this.leaderboardVisible) {
        this.updateLeaderboardDisplay();
      }
    }
  }

  /**
   * Update the leaderboard display with current data
   */
  private updateLeaderboardDisplay(): void {
    if (!this.leaderboardElement) return;

    const leaderboardBody = document.getElementById("leaderboard-body");
    if (!leaderboardBody) return;

    // Clear existing rows
    leaderboardBody.innerHTML = "";

    // Get current player nickname for highlighting
    const currentPlayerNickname = this.controls.getPlayerNickname
      ? this.controls.getPlayerNickname()
      : "Player";

    // Add rows for each player
    this.leaderboardData.forEach((player, index) => {
      const row = document.createElement("tr");

      // Highlight current player
      if (player.name === currentPlayerNickname) {
        row.classList.add("highlight-player");
      }

      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${player.name}</td>
        <td>${player.score}</td>
        <td>${player.kills}</td>
      `;

      leaderboardBody.appendChild(row);
    });
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
