import type { IsometricControls } from "./FPSControls";

export class HUD {
  private container: HTMLElement;
  private uiOverlay: HTMLElement;
  private fpsElement: HTMLElement | null = null;
  private currentAmmoElement: HTMLElement | null = null;
  private totalAmmoElement: HTMLElement | null = null;
  private reloadIndicatorElement: HTMLElement | null = null;

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
      </div>
    `;
    return uiOverlay;
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
      } else {
        this.reloadIndicatorElement.classList.add("hidden");
      }
    }
  }
}
