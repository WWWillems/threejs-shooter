import type { IsometricControls } from "./FPSControls";

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

  // FPS tracking
  private frameCount = 0;
  private lastTime = performance.now();

  constructor(container: HTMLElement, private controls: IsometricControls) {
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
  }

  private createUIOverlay(): HTMLElement {
    const uiOverlay = document.createElement("div");
    uiOverlay.className = "ui-overlay";
    uiOverlay.innerHTML = `
      <h2>Three.js Shooter</h2>
      <p>FPS: <span id="fps">0</span></p>
      <div class="ammo-display">
        <p>Ammo: <span id="current-ammo">20</span> / <span id="total-ammo">250</span></p>
        <div id="reload-indicator" class="reload-indicator hidden">RELOADING...</div>
        <div id="empty-mag-indicator" class="empty-mag-indicator hidden">PRESS R TO RELOAD</div>
        <div id="no-ammo-indicator" class="no-ammo-indicator hidden">OUT OF AMMO</div>
      </div>
    `;
    return uiOverlay;
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

  public update(): void {
    // Update FPS counter
    this.updateFPS();

    // Update ammo display
    this.updateAmmoDisplay();
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
      this.currentAmmoElement.textContent = ammoInfo.current.toString();
    }

    if (this.totalAmmoElement) {
      this.totalAmmoElement.textContent = ammoInfo.total.toString();
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
}
