import "../styles/menu.css";
import {
  MAX_NICKNAME_LENGTH,
  sanitizeNickname,
} from "@threejs-shooter/shared";
import { renderControlsList } from "./controlsDisplay";

type MenuScreenName = "mode-select" | "nickname";

/**
 * The pre-game menu. Shows a mode-select landing screen (Single Player -
 * disabled, coming soon; Multiplayer - active) with the controls list, then
 * the nickname/Start Game step once Multiplayer is picked.
 */
export class MainMenu {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private isVisible = true;
  private onStartCallback: ((nickname: string) => void) | null = null;

  constructor(
    container: HTMLElement,
    onStartCallback?: (nickname: string) => void
  ) {
    this.container = container;
    if (onStartCallback) {
      this.onStartCallback = onStartCallback;
    }
    this.overlay = this.createOverlay();
    this.container.appendChild(this.overlay);

    this.bindModeSelectScreen();
    this.bindNicknameScreen();
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "main-menu";
    overlay.innerHTML = `
      <div class="menu-panel">
        <div class="menu-screen menu-screen-mode-select" id="menu-screen-mode-select">
          <div class="logo-container">
            <img src="/logo.png" alt="Bang Bang" class="game-logo">
          </div>
          <div class="controls-panel">
            <div class="controls-panel-title">Controls</div>
            ${renderControlsList()}
          </div>
          <div class="mode-cards">
            <button type="button" class="mode-card" id="mode-card-single-player" disabled>
              <span class="mode-card-badge">Coming soon</span>
              <span class="mode-card-title">Single Player</span>
              <span class="mode-card-subtitle">Practice offline</span>
            </button>
            <button type="button" class="mode-card mode-card-primary" id="mode-card-multiplayer">
              <span class="mode-card-title">Multiplayer</span>
              <span class="mode-card-subtitle">Play with others online</span>
            </button>
          </div>
        </div>
        <div class="menu-screen menu-screen-nickname" id="menu-screen-nickname" hidden>
          <button type="button" class="menu-back-button" id="menu-back-button">&larr; Back</button>
          <div class="logo-container">
            <img src="/logo.png" alt="Bang Bang" class="game-logo">
          </div>
          <div class="nickname-container">
            <label for="nickname-input">Enter your nickname:</label>
            <input type="text" id="nickname-input" class="nickname-input" placeholder="Your nickname" maxlength="${MAX_NICKNAME_LENGTH}" autocomplete="nickname">
          </div>
          <p class="menu-error" id="menu-error" role="alert" hidden></p>
          <button type="button" id="start-button" class="start-button" disabled>START GAME</button>
        </div>
      </div>
    `;

    return overlay;
  }

  private bindModeSelectScreen(): void {
    const multiplayerCard = document.getElementById("mode-card-multiplayer");
    if (multiplayerCard) {
      multiplayerCard.addEventListener(
        "click",
        this.showScreen.bind(this, "nickname")
      );
    }
    // The single player card stays disabled - no listener needed until the
    // mode ships.
  }

  private bindNicknameScreen(): void {
    const backButton = document.getElementById("menu-back-button");
    if (backButton) {
      backButton.addEventListener(
        "click",
        this.showScreen.bind(this, "mode-select")
      );
    }

    const startButton = document.getElementById("start-button");
    if (startButton) {
      startButton.addEventListener(
        "click",
        this.onStartButtonClick.bind(this)
      );
    }

    const nicknameInput = document.getElementById("nickname-input");
    if (nicknameInput) {
      nicknameInput.addEventListener(
        "input",
        this.validateNickname.bind(this)
      );
    }
  }

  private showScreen(name: MenuScreenName): void {
    this.getScreen("mode-select").hidden = name !== "mode-select";
    this.getScreen("nickname").hidden = name !== "nickname";
    if (name === "nickname") {
      document.getElementById("nickname-input")?.focus();
    }
  }

  private getScreen(name: MenuScreenName): HTMLElement {
    const screen = document.getElementById(`menu-screen-${name}`);
    if (!screen) {
      throw new Error(`Missing menu screen: ${name}`);
    }
    return screen;
  }

  private onStartButtonClick(): void {
    this.clearError();
    // Hide the overlay
    this.hide();

    // Get nickname value
    const nicknameInput = document.getElementById(
      "nickname-input"
    ) as HTMLInputElement;
    const nickname = sanitizeNickname(nicknameInput?.value);

    // Call the start callback if provided
    if (this.onStartCallback) {
      this.onStartCallback(nickname);
    }
  }

  private validateNickname(): void {
    const nicknameInput = document.getElementById(
      "nickname-input"
    ) as HTMLInputElement;
    const startButton = document.getElementById(
      "start-button"
    ) as HTMLButtonElement;

    if (nicknameInput && startButton) {
      startButton.disabled = !nicknameInput.value.trim();
    }
  }

  /** Show why the last Start Game attempt did not get us into the game. */
  public showError(message: string): void {
    const error = document.getElementById("menu-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
    this.showScreen("nickname");
  }

  private clearError(): void {
    const error = document.getElementById("menu-error");
    if (!error) return;
    error.textContent = "";
    error.hidden = true;
  }

  public hide(): void {
    if (this.isVisible) {
      this.overlay.style.display = "none";
      this.isVisible = false;
    }
  }

  public show(): void {
    if (!this.isVisible) {
      this.overlay.style.display = "flex";
      this.isVisible = true;
    }
  }
}
