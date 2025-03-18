import "../styles/overlay.css";

export class StartOverlay {
  private container: HTMLElement;
  private overlay: HTMLElement;
  private isVisible = true;
  private onStartCallback: (() => void) | null = null;

  constructor(container: HTMLElement, onStartCallback?: () => void) {
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
        <button id="start-button" class="start-button">START GAME</button>
      </div>
    `;

    return overlay;
  }

  private onStartButtonClick(): void {
    // Hide the overlay
    this.hide();

    // Call the start callback if provided
    if (this.onStartCallback) {
      this.onStartCallback();
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
