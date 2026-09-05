import "../styles/overlay.css";

export class StartOverlay {
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

    // Add start button event listener
    const startButton = document.getElementById("start-button");
    if (startButton) {
      startButton.addEventListener("click", this.onStartButtonClick.bind(this));
    }

    // Add nickname input validation
    const nicknameInput = document.getElementById("nickname-input");
    if (nicknameInput) {
      nicknameInput.addEventListener("input", this.validateNickname.bind(this));
    }
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "start-overlay";
    overlay.innerHTML = `
      <div class="start-content">
        <div class="logo-container">
          <img src="/logo.png" alt="Bang Bang" class="game-logo">
        </div>
        <div class="controls-info">
          <div class="controls-title">Controls</div>
          <ul>
            <li><strong>WASD</strong> - Move</li>
            <li><strong>Mouse</strong> - Aim</li>
            <li><strong>Left Click</strong> - Shoot</li>
            <li><strong>R</strong> - Reload</li>
            <li><strong>1-3</strong> - Switch weapons</li>
            <li><strong>Q/E</strong> - Cycle weapons</li>
            <li><strong>G</strong> - Drop weapon</li>
          </ul>
        </div>
        <div class="nickname-container">
          <label for="nickname-input">Enter your nickname:</label>
          <input type="text" id="nickname-input" class="nickname-input" placeholder="Your nickname">
        </div>
        <button id="start-button" class="start-button" disabled>START GAME</button>
      </div>
    `;

    return overlay;
  }

  private onStartButtonClick(): void {
    // Hide the overlay
    this.hide();

    // Get nickname value
    const nicknameInput = document.getElementById(
      "nickname-input"
    ) as HTMLInputElement;
    const nickname = nicknameInput?.value.trim() || "Player";

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
