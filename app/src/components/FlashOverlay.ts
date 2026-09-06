import { GRENADE_EFFECTS } from "@threejs-shooter/shared";

/**
 * The local player's view of being flashbanged: a white-out over the whole
 * screen that fades back over the blind duration. Presentation only; the
 * server decided who was blinded and how hard.
 */
export class FlashOverlay {
  private readonly element = document.createElement("div");
  /** Seconds of blindness left; 0 when clear. */
  private remaining = 0;
  /** Blind duration this flash started with, so the fade is proportional. */
  private duration = 0;

  constructor(container: HTMLElement) {
    this.element.className = "flash-overlay";
    this.element.setAttribute("aria-hidden", "true");
    container.append(this.element);
  }

  /** Blind the player at `intensity` (0..1) of full strength. Overlapping flashes take the stronger. */
  flash(intensity: number): void {
    const duration = GRENADE_EFFECTS.flash.blindDuration * Math.min(1, Math.max(0, intensity));
    if (duration <= this.remaining) return;
    this.remaining = duration;
    this.duration = duration;
    this.render();
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    this.render();
  }

  private render(): void {
    // Hold at full white for the first stretch, then ease out.
    const t = this.duration > 0 ? this.remaining / this.duration : 0;
    const opacity = Math.min(1, t * 1.33) ** 1.5;
    this.element.style.opacity = opacity.toFixed(3);
    this.element.style.display = opacity > 0.005 ? "block" : "none";
  }

  /** Clear any blindness instantly (death, round reset). */
  clear(): void {
    this.remaining = 0;
    this.element.style.opacity = "0";
    this.element.style.display = "none";
  }
}
