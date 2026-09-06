import {
  DEFAULT_MATCH_RULES,
  GAME_EVENTS,
  TEAMS,
  type LeaderboardEntry,
  type MatchPhase,
  type MatchSnapshot,
  type RoundResult,
  type RoundWinner,
} from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import { renderTeamTable, teamTableMarkup } from "./leaderboardTable";
import "../styles/match.css";

/** What the match phase does to the local player; wired up in main.ts. */
export interface MatchPhaseHost {
  /** Countdown: nobody moves. */
  setFrozen(frozen: boolean): void;
  /** Round end and countdown: no shooting or throwing, for feel (the server rejects anyway). */
  setCombatAllowed(allowed: boolean): void;
  /** The round-end board or the reset replaces the death screen. */
  hideDeathOverlay(): void;
}

const TEAM_LABEL = { blue: "Blue", red: "Red" } as const;

const WINNER_TITLE: Record<RoundWinner, string> = {
  blue: "BLUE WINS",
  red: "RED WINS",
  draw: "DRAW",
};

/** How long "GO" stays up when the round starts, ms. */
const GO_FLASH_MS = 900;

/**
 * Renders the round loop: the clock under the score chip, the countdown, and
 * the round-end board. Steady state comes from the `match` block in every
 * snapshot (and in `game:state`); `match:phase` events mark the transitions
 * and carry the results. The clock runs on server time, never a local timer.
 */
export class MatchPhaseUi {
  private phase: MatchPhase | null = null;
  private phaseEndsAt: number | null = null;
  private killLimit = DEFAULT_MATCH_RULES.killLimit;
  /** Latest server clock we heard, and when we heard it, to extrapolate between snapshots. */
  private serverTime = 0;
  private serverTimeAt = performance.now();
  private goFlashTimeout: number | null = null;

  private readonly clockElement: HTMLElement;
  private readonly countdownElement: HTMLElement;
  private readonly boardElement: HTMLElement;
  private readonly boardTitle: HTMLElement;
  private readonly boardScore: HTMLElement;
  private readonly boardFooter: HTMLElement;

  constructor(
    container: HTMLElement,
    private readonly net: NetworkClient,
    private readonly host: MatchPhaseHost
  ) {
    this.clockElement = this.mount(container, "match-clock", "match-clock hidden");
    this.countdownElement = this.mount(container, "match-countdown", "match-countdown hidden");
    this.boardElement = this.mount(container, "match-board", "match-board hidden");
    this.boardElement.innerHTML = `
      <div class="match-board-panel">
        <div class="match-board-kicker">Round over</div>
        <h1 class="match-board-title" id="match-board-title"></h1>
        <div class="match-board-score" id="match-board-score"></div>
        <div class="leaderboard-columns">
          ${teamTableMarkup("blue", TEAM_LABEL.blue, "match-board-body-blue")}
          ${teamTableMarkup("red", TEAM_LABEL.red, "match-board-body-red")}
        </div>
        <div class="match-board-footer" id="match-board-footer"></div>
      </div>`;
    this.boardTitle = this.boardElement.querySelector("#match-board-title") as HTMLElement;
    this.boardScore = this.boardElement.querySelector("#match-board-score") as HTMLElement;
    this.boardFooter = this.boardElement.querySelector("#match-board-footer") as HTMLElement;

    this.listen();
    window.setInterval(() => this.renderClock(), 200);
  }

  private mount(container: HTMLElement, id: string, className: string): HTMLElement {
    const element = document.createElement("div");
    element.id = id;
    element.className = className;
    container.appendChild(element);
    return element;
  }

  private listen(): void {
    this.net.on(GAME_EVENTS.GAME.STATE, ({ match }) => {
      this.adopt(match, match.result, null);
    });
    this.net.on(GAME_EVENTS.WORLD.SNAPSHOT, ({ serverTime, match }) => {
      this.serverTime = serverTime;
      this.serverTimeAt = performance.now();
      // Snapshots also heal a missed transition event.
      if (match.phase !== this.phase) this.adopt(match, null, null);
      else this.phaseEndsAt = match.phaseEndsAt;
    });
    this.net.on(GAME_EVENTS.MATCH.PHASE, (event) => {
      this.adopt(event, event.result ?? null, event.result?.leaderboard ?? null);
    });
  }

  /** Move the UI to `match.phase`, with the board data when entering round-end. */
  private adopt(
    match: MatchSnapshot,
    result: RoundResult | null,
    leaderboard: LeaderboardEntry[] | null
  ): void {
    const previous = this.phase;
    this.phase = match.phase;
    this.phaseEndsAt = match.phaseEndsAt;

    switch (match.phase) {
      case "warmup":
        this.host.setFrozen(false);
        this.host.setCombatAllowed(true);
        this.hideBoard();
        this.hideCountdown();
        break;
      case "countdown":
        this.host.hideDeathOverlay();
        this.host.setFrozen(true);
        this.host.setCombatAllowed(false);
        this.hideBoard();
        this.showCountdown();
        break;
      case "active":
        this.host.setFrozen(false);
        this.host.setCombatAllowed(true);
        this.hideBoard();
        if (previous === "countdown") this.flashGo();
        else this.hideCountdown();
        break;
      case "round-end":
        this.host.hideDeathOverlay();
        this.host.setFrozen(false);
        this.host.setCombatAllowed(false);
        this.hideCountdown();
        this.showBoard(result, leaderboard);
        break;
      default: {
        const unhandled: never = match.phase;
        throw new Error(`Unhandled match phase: ${String(unhandled)}`);
      }
    }
    this.renderClock();
  }

  // ---- clock -------------------------------------------------------------

  /** Milliseconds left in the current phase by the server's clock, or null in warmup. */
  private remainingMs(): number | null {
    if (this.phaseEndsAt === null) return null;
    const now = this.serverTime + (performance.now() - this.serverTimeAt);
    return Math.max(0, this.phaseEndsAt - now);
  }

  private renderClock(): void {
    if (this.phase === null) {
      this.clockElement.classList.add("hidden");
      return;
    }
    this.clockElement.classList.remove("hidden");
    const remaining = this.remainingMs();
    const seconds = remaining === null ? 0 : Math.ceil(remaining / 1000);

    switch (this.phase) {
      case "warmup":
        this.clockElement.textContent = "Warmup · waiting for players";
        break;
      case "countdown":
        this.clockElement.textContent = `Round starts in ${seconds}`;
        this.countdownElement.textContent = String(Math.max(1, seconds));
        break;
      case "active":
        this.clockElement.textContent = `${formatClock(remaining ?? 0)} · first to ${this.killLimit}`;
        break;
      case "round-end":
        this.clockElement.textContent = `Next round in ${seconds}`;
        this.boardFooter.textContent = `Next round in ${seconds}`;
        break;
      default: {
        const unhandled: never = this.phase;
        throw new Error(`Unhandled match phase: ${String(unhandled)}`);
      }
    }
  }

  // ---- countdown ---------------------------------------------------------

  private showCountdown(): void {
    this.clearGoFlash();
    this.countdownElement.classList.remove("hidden", "go");
  }

  private hideCountdown(): void {
    this.clearGoFlash();
    this.countdownElement.classList.add("hidden");
  }

  private flashGo(): void {
    this.clearGoFlash();
    this.countdownElement.textContent = "GO";
    this.countdownElement.classList.remove("hidden");
    this.countdownElement.classList.add("go");
    this.goFlashTimeout = window.setTimeout(() => this.hideCountdown(), GO_FLASH_MS);
  }

  private clearGoFlash(): void {
    if (this.goFlashTimeout !== null) {
      window.clearTimeout(this.goFlashTimeout);
      this.goFlashTimeout = null;
    }
    this.countdownElement.classList.remove("go");
  }

  // ---- round-end board ---------------------------------------------------

  private showBoard(result: RoundResult | null, leaderboard: LeaderboardEntry[] | null): void {
    if (result) {
      this.boardTitle.textContent = WINNER_TITLE[result.winner];
      this.boardTitle.dataset.winner = result.winner;
      this.boardScore.innerHTML = `
        <span class="team-blue">${TEAM_LABEL.blue} ${result.teamScores.blue}</span>
        <span class="match-board-score-separator">:</span>
        <span class="team-red">${result.teamScores.red} ${TEAM_LABEL.red}</span>`;
    }
    if (leaderboard) {
      this.renderBoardRows(leaderboard);
    } else {
      // A late joiner has the result but no rows: the round's rows are still
      // on the server until the reset.
      this.renderBoardRows([]);
      void this.net
        .getLeaderboard()
        .then((data) => {
          if (this.phase === "round-end") this.renderBoardRows(Object.values(data.players));
        })
        .catch(() => undefined);
    }
    this.boardElement.classList.remove("hidden");
  }

  private renderBoardRows(rows: LeaderboardEntry[]): void {
    for (const team of TEAMS) {
      const body = document.getElementById(`match-board-body-${team}`);
      if (body) renderTeamTable(body, rows, team, this.net.selfId);
    }
  }

  private hideBoard(): void {
    this.boardElement.classList.add("hidden");
  }
}

/** `mm:ss` for a duration in ms, rounded up so the clock hits 0:00 exactly at the end. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
