import * as THREE from "three";
import { IsometricControls } from "../components/IsometricControls";
import { HUD } from "../components/HUD";
import { PickupManager } from "../components/PickupManager";
import { RemotePlayerManager } from "../components/RemotePlayerManager";

// Define window augmentation for impact animations
declare global {
  interface Window {
    __impactAnimations?: Array<(delta: number) => void>;
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

    // Rotate the decoration cubes
    if (this.decorationCubes.length > 0) {
      this.decorationCubes[0].rotation.y += 0.01;
      this.decorationCubes[1].rotation.x += 0.01;
      this.decorationCubes[2].rotation.z += 0.01;
    }

    // Check for player collision with moving cars (player damage)
    const playerPosition = this.player.position.clone();
    const playerHeight = this.controls.getPlayerHeight();
    const carColliders = this.controls.getCarColliders();

    for (const car of carColliders) {
      // Create car collision box
      const carBox = new THREE.Box3();
      carBox.setFromCenterAndSize(
        new THREE.Vector3(
          car.carObj.position.x,
          car.carObj.position.y + car.heightOffset,
          car.carObj.position.z
        ),
        car.dimensions
      );

      // Create player collision box
      const playerBox = new THREE.Box3();
      playerBox.setFromCenterAndSize(
        new THREE.Vector3(
          playerPosition.x,
          playerPosition.y + playerHeight / 2,
          playerPosition.z
        ),
        new THREE.Vector3(1, playerHeight, 1)
      );

      // Check if player is colliding with car
      if (playerBox.intersectsBox(carBox)) {
        // Apply damage to player (20 damage per second while in contact with car)
        const playerController = this.controls.getPlayerController();
        if (playerController) {
          playerController.takeDamage(20 * delta);
        }

        break;
      }
    }

    // Update controls
    this.controls.update();

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
