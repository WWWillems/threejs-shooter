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
  private inventoryElement: HTMLElement | null = null;
  private weaponSlots: HTMLElement[] = [];

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
    this.inventoryElement = document.getElementById("inventory");

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
      <div id="inventory" class="inventory-container">
        <h3>Inventory</h3>
        <div class="weapon-slots">
          <div id="weapon-slot-0" class="weapon-slot"></div>
          <div id="weapon-slot-1" class="weapon-slot"></div>
          <div id="weapon-slot-2" class="weapon-slot"></div>
        </div>
        <p class="inventory-tip">Press 1-3 to switch weapons, or Q/E to cycle</p>
      </div>
    `;
    return uiOverlay;
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

  public update(): void {
    // Update FPS counter
    this.updateFPS();

    // Update ammo display
    this.updateAmmoDisplay();

    // Update inventory display
    this.updateInventoryDisplay();
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

  private updateInventoryDisplay(): void {
    // Get inventory from controls
    const inventory = this.controls.getInventory();
    const currentWeaponIndex = this.controls.getCurrentWeaponIndex();

    // Update each weapon slot
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const slotElement = this.weaponSlots[i];
      if (slotElement && i < inventory.length) {
        const weapon = inventory[i];

        // Get the appropriate weapon icon based on weapon name
        const weaponIcon = this.getWeaponIcon(weapon.name);

        // Update slot content
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
      default:
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
          <rect x="30" y="15" width="40" height="10" fill="#999" />
        </svg>`;
    }
  }
}
