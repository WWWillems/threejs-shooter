import * as THREE from "three";
import socket from "../api/socket";
import type { HUD } from "./HUD";
import { WeaponSystem } from "./Weapon";
import { GAME_EVENTS } from "../events/constants";
import type { WeaponEvent } from "../events/types";

interface RemotePlayer {
  id: string;
  mesh: THREE.Mesh;
  lastUpdate: number;
  position: THREE.Vector3;
  rotation: number;

  currentHealth: number;

  weaponSystem: WeaponSystem;
}

/**
 * Manages remote players in the multiplayer game
 */
export class RemotePlayerManager {
  private players: Map<string, RemotePlayer> = new Map();
  private scene: THREE.Scene;
  private hud: HUD;

  constructor(scene: THREE.Scene, hud: HUD) {
    this.scene = scene;
    this.hud = hud;
    this.setupSocketListeners();
  }

  /**
   * Set up socket listeners for remote player events
   */
  private setupSocketListeners(): void {
    // Listen for new player connections
    socket.on(GAME_EVENTS.USER.CONNECTED, ({ message, userId }) => {
      console.log("New player connected:", userId, message);
      this.addPlayer(userId);

      this.hud.showNotification(
        "user connected",
        "User connected",
        message,
        "👋"
      );
    });

    // Listen for player disconnections
    socket.on(GAME_EVENTS.USER.DISCONNECTED, ({ message, userId }) => {
      console.log("Player disconnected:", userId, message);
      this.removePlayer(userId);

      this.hud.showNotification(
        "user disconnected",
        "User disconnected",
        message,
        "👋"
      );
    });

    // Listen for player position updates
    socket.on(GAME_EVENTS.PLAYER.POSITION, ({ userId, position, rotation }) => {
      this.updatePlayerPosition(userId, position, rotation);
    });

    // Listen for player weapon updates
    socket.on(
      GAME_EVENTS.WEAPON.SWITCH,
      ({ userId, weaponType, action }: { userId: string } & WeaponEvent) => {
        if (action === "switch") {
          this.updatePlayerWeapon(userId, this.getWeaponIndex(weaponType));
        }
      }
    );
  }

  /**
   * Add a new remote player to the scene
   */
  private addPlayer(userId: string): void {
    // Validate userId
    if (!userId) {
      console.error("Attempted to add player with invalid userId:", userId);
      return;
    }

    // Check if player already exists
    if (this.players.has(userId)) {
      console.warn(`Player ${userId} already exists`);
      return;
    }

    // Create a player mesh with a different color from the local player
    const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
    // Generate a unique but consistent color based on userId
    const hue = this.getHueFromString(userId);
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.8, 0.5),
    });

    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);

    // Set initial position (random position within reasonable bounds)
    const randomX = (Math.random() - 0.5) * 10;
    const randomZ = (Math.random() - 0.5) * 10;
    playerMesh.position.set(randomX, 1, randomZ);

    // Configure shadow settings
    playerMesh.castShadow = true;
    playerMesh.receiveShadow = true;

    // Add to scene
    this.scene.add(playerMesh);

    const weaponSystem = new WeaponSystem(this.scene, playerMesh);
    weaponSystem.handleRemoteEvent(() => {
      weaponSystem.switchToWeapon(0);
    });

    // Immediately update the weapon position
    weaponSystem.updateWeaponPosition(false);

    // Store the player
    this.players.set(userId, {
      id: userId,
      mesh: playerMesh,
      lastUpdate: performance.now(),
      position: playerMesh.position.clone(),
      rotation: 0,
      currentHealth: 100,
      weaponSystem,
    });

    console.log(`Added remote player: ${userId}`);
  }

  /**
   * Remove a remote player from the scene
   */
  private removePlayer(userId: string): void {
    const player = this.players.get(userId);
    if (!player) {
      console.warn(`Cannot remove non-existent player: ${userId}`);
      return;
    }

    // Remove from scene
    this.scene.remove(player.mesh);

    // Remove from players map
    this.players.delete(userId);

    console.log(`Removed remote player: ${userId}`);
  }

  /**
   * Update a remote player's position and rotation
   */
  private updatePlayerPosition(
    userId: string,
    position: { x: number; y: number; z: number },
    rotation: number
  ): void {
    // Validate userId to prevent errors
    if (!userId) {
      console.error(
        "Received player position update with invalid userId:",
        userId
      );
      return;
    }

    const player = this.players.get(userId);
    if (!player) {
      // Player doesn't exist yet, create them
      this.addPlayer(userId);
      this.updatePlayerPosition(userId, position, rotation);
      return;
    }

    // Update the target position and rotation
    player.position.set(position.x, position.y, position.z);
    player.rotation = rotation;
    player.lastUpdate = performance.now();
  }

  /**
   * Update all remote players (smoothly interpolate positions)
   */
  public update(_delta: number): void {
    // Update each player's visual representation
    for (const player of this.players.values()) {
      // Smoothly interpolate position
      player.mesh.position.lerp(player.position, 0.3);

      // Smoothly interpolate rotation
      const currentRotation = player.mesh.rotation.y;
      const targetRotation = player.rotation;
      player.mesh.rotation.y += (targetRotation - currentRotation) * 0.3;

      // Update the weapon position to match the player's new position and rotation
      player.weaponSystem.updateWeaponPosition(false);
    }
  }

  /**
   * Update a remote player's weapon
   */
  private updatePlayerWeapon(userId: string, weaponIndex: number): void {
    const player = this.players.get(userId);
    if (!player) {
      return;
    }
    console.log(`> ${userId} switched to weapon ${weaponIndex}`);
    player.weaponSystem.handleRemoteEvent(() => {
      player.weaponSystem.switchToWeapon(weaponIndex);
    });
  }

  /**
   * Generate a hue value (0-1) from a string consistently
   */
  private getHueFromString(str: string): number {
    // Handle undefined or null string
    if (!str) {
      console.warn("Received undefined or empty userId for color generation");
      return Math.random(); // Return a random hue as fallback
    }

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return (hash % 360) / 360;
  }

  /**
   * Convert weapon type to index
   */
  private getWeaponIndex(weaponType: string): number {
    switch (weaponType.toLowerCase()) {
      case "pistol":
        return 0;
      case "assault rifle":
        return 1;
      case "shotgun":
        return 2;
      default:
        return 0; // Default to pistol
    }
  }

  /**
   * Get all remote players
   */
  public getPlayers(): Map<string, RemotePlayer> {
    return this.players;
  }

  /**
   * Clear all remote players
   */
  public clear(): void {
    for (const playerId of this.players.keys()) {
      this.removePlayer(playerId);
    }
  }
}
