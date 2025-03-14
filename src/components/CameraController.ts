import * as THREE from "three";

/**
 * Camera settings interface
 */
interface CameraSettings {
  cameraHeight: number;
  crouchCameraHeight: number;
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
  private crouchCameraHeight: number;
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
    this.crouchCameraHeight = settings?.crouchCameraHeight || 8;
    this.cameraDistance = settings?.cameraDistance || 20;
    this.angle = settings?.angle || Math.PI / 4; // 45 degrees

    // Initial camera setup
    this.setupIsometricView();
  }

  /**
   * Set up initial isometric view
   */
  private setupIsometricView(): void {
    // Position the camera for isometric view
    // Typical isometric angle is 45 degrees horizontally and 35.264 degrees vertically
    const angle = this.angle;
    const elevation = Math.atan(1 / Math.sqrt(2)); // ~35.264 degrees

    // Update camera position relative to player
    this.updateCameraPosition(false); // Start not crouched

    // Point camera to player
    this.camera.lookAt(this.player.position);
  }

  /**
   * Update camera position to follow the player
   */
  public updateCameraPosition(isCrouching: boolean): void {
    // Determine camera height based on crouch state
    const currentCameraHeight = isCrouching
      ? this.crouchCameraHeight
      : this.cameraHeight;

    // Calculate camera position based on player position
    this.camera.position.set(
      this.player.position.x + this.cameraDistance * Math.sin(this.angle),
      this.player.position.y + currentCameraHeight,
      this.player.position.z + this.cameraDistance * Math.cos(this.angle)
    );

    // Make the camera look at the player
    this.camera.lookAt(this.player.position);
  }

  /**
   * Update camera settings
   */
  public updateSettings(settings: Partial<CameraSettings>): void {
    if (settings.cameraHeight !== undefined) {
      this.cameraHeight = settings.cameraHeight;
    }

    if (settings.crouchCameraHeight !== undefined) {
      this.crouchCameraHeight = settings.crouchCameraHeight;
    }

    if (settings.cameraDistance !== undefined) {
      this.cameraDistance = settings.cameraDistance;
    }

    if (settings.angle !== undefined) {
      this.angle = settings.angle;
    }
  }
}
