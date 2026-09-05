import * as THREE from "three";

/**
 * Camera settings interface
 */
interface CameraSettings {
  cameraHeight: number;
  cameraDistance: number;
  angle: number; // Camera angle in radians (default: PI/4)
}

/**
 * Controls camera positioning and behavior
 */
export class CameraController {
  // Make camera public so it can be accessed by other components
  public camera: THREE.Camera;
  private player: THREE.Object3D;

  // Camera settings
  private cameraHeight: number;
  private cameraDistance: number;
  private angle: number;

  constructor(
    camera: THREE.Camera,
    player: THREE.Object3D,
    settings?: Partial<CameraSettings>
  ) {
    this.camera = camera;
    this.player = player;

    // Default settings
    this.cameraHeight = settings?.cameraHeight || 15;
    this.cameraDistance = settings?.cameraDistance || 20;
    this.angle = settings?.angle || Math.PI / 4; // 45 degrees

    // Initial camera setup
    this.setupIsometricView();
  }

  /**
   * Set up initial isometric view
   */
  private setupIsometricView(): void {
    this.updateCameraPosition();
  }

  /**
   * Update camera position to follow the player
   * @param focusY Vertical world position to keep centered in the isometric view
   */
  public updateCameraPosition(focusY = this.player.position.y): void {
    // Calculate camera position based on player position
    this.camera.position.set(
      this.player.position.x + this.cameraDistance * Math.sin(this.angle),
      focusY + this.cameraHeight,
      this.player.position.z + this.cameraDistance * Math.cos(this.angle)
    );

    // Keep the isometric target at the same height while the player crouches.
    this.camera.lookAt(this.player.position.x, focusY, this.player.position.z);
  }

  /**
   * Update camera settings
   */
  public updateSettings(settings: Partial<CameraSettings>): void {
    if (settings.cameraHeight !== undefined) {
      this.cameraHeight = settings.cameraHeight;
    }

    if (settings.cameraDistance !== undefined) {
      this.cameraDistance = settings.cameraDistance;
    }

    if (settings.angle !== undefined) {
      this.angle = settings.angle;
    }
  }
}
