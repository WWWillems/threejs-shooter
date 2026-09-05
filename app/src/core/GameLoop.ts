import * as THREE from "three";
import { IsometricControls } from "../components/IsometricControls";
import { HUD } from "../components/HUD";
import { PickupManager } from "../components/PickupManager";
import { RemotePlayerManager } from "../components/RemotePlayerManager";

// Define window augmentation for impact animations
type ImpactAnimationFn = (delta: number) => void;

// Add window interface augmentation
declare global {
  interface Window {
    __impactAnimations: ImpactAnimationFn[];
  }
}

export class GameLoop {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: IsometricControls;
  private hud: HUD;
  private pickupManager: PickupManager;
  private remotePlayerManager: RemotePlayerManager;
  private player: THREE.Mesh;
  private lastFrameTime: number;
  private decorationCubes: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    controls: IsometricControls,
    hud: HUD,
    pickupManager: PickupManager,
    remotePlayerManager: RemotePlayerManager,
    player: THREE.Mesh,
    decorationCubes: THREE.Mesh[] = []
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.hud = hud;
    this.pickupManager = pickupManager;
    this.remotePlayerManager = remotePlayerManager;
    this.player = player;
    this.decorationCubes = decorationCubes;
    this.lastFrameTime = performance.now();
  }

  /**
   * Start the animation loop
   */
  public start(): void {
    this.animate();
  }

  /**
   * Animation loop
   */
  private animate = (): void => {
    requestAnimationFrame(this.animate);

    // Calculate delta time for smooth animations
    const time = performance.now();
    const delta = (time - this.lastFrameTime) / 1000; // Convert to seconds
    this.lastFrameTime = time;

    // Car contact damage is resolved by the server (GameRoom.stepCarContact)
    // and arrives as COMBAT.HIT; nothing to do locally.

    // Update controls
    this.controls.update();

    // Update automatic weapon firing
    const playerController = this.controls.getPlayerController();
    if (playerController) {
      const weaponSystem = playerController.getWeaponSystem();
      if (weaponSystem) {
        weaponSystem.updateAutoFire(this.scene, delta);
      }
    }

    // Update pickup manager
    this.pickupManager.update(delta);

    // Update remote players
    this.remotePlayerManager.update(delta);

    // Update HUD
    if (this.hud) {
      this.hud.update();
    }

    // Update bullet impact animations
    if (window.__impactAnimations && window.__impactAnimations.length > 0) {
      // Create a copy of the array to prevent issues if animations modify the array
      const animations = [...window.__impactAnimations];
      for (const animation of animations) {
        animation(delta);
      }
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  };
}
