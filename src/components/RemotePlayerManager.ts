import * as THREE from "three";
import socket from "../api/socket";
import type { HUD } from "./HUD";
import { WeaponSystem } from "./Weapon";
import { GAME_EVENTS } from "../events/constants";
import type { WeaponEvent } from "../events/types";
import type { CollisionDetector } from "./CollisionInterface";
import { PlayerCollider, PLAYER_DIMENSIONS } from "./PlayerCollider";
import { PlayerUtils } from "./PlayerController";

interface RemotePlayer {
  id: string;
  mesh: THREE.Mesh;
  lastUpdate: number;
  position: THREE.Vector3;
  rotation: number;

  currentHealth: number;
  isDead: boolean;

  weaponSystem: WeaponSystem;
}

/**
 * Manages remote players in the multiplayer game
 */
export class RemotePlayerManager {
  private players: Map<string, RemotePlayer> = new Map();
  private scene: THREE.Scene;
  private hud: HUD;
  private collisionDetector?: CollisionDetector;

  constructor(
    scene: THREE.Scene,
    hud: HUD,
    collisionDetector?: CollisionDetector
  ) {
    this.scene = scene;
    this.hud = hud;
    this.collisionDetector = collisionDetector;
    this.setupSocketListeners();
  }

  /**
   * Set up socket listeners for remote player events
   */
  private setupSocketListeners(): void {
    // Listen for new player connections
    socket.on(GAME_EVENTS.USER.CONNECTED, ({ message, userId }) => {
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

    // Listen for player status updates (death/respawn)
    socket.on(GAME_EVENTS.PLAYER.STATUS, ({ userId, status, position }) => {
      this.handlePlayerStatusChange(userId, status, position);
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

    // Listen for weapon shoot events
    socket.on(
      GAME_EVENTS.WEAPON.SHOOT,
      ({ userId, data }: { userId: string } & WeaponEvent) => {
        const player = this.players.get(userId);
        if (!player || !data?.position || !data?.direction) {
          console.warn("Invalid remote shoot data:", { player, data });
          return;
        }

        const position = new THREE.Vector3(
          data.position.x,
          data.position.y,
          data.position.z
        );
        const direction = new THREE.Vector3(
          data.direction.x,
          data.direction.y,
          data.direction.z
        );

        player.weaponSystem.handleRemoteEvent(() => {
          // Create bullet at the remote player's position with the correct direction
          player.weaponSystem.shootRemote(this.scene, position, direction);
        });
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
    const playerGeometry = new THREE.BoxGeometry(
      PLAYER_DIMENSIONS.width,
      PLAYER_DIMENSIONS.height,
      PLAYER_DIMENSIONS.depth
    );
    // Generate a unique but consistent color based on userId
    const hue = this.getHueFromString(userId);
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.8, 0.5),
    });

    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);

    // Set initial height in userData
    playerMesh.userData.height = 1; // Set to a lower height that matches the visual model

    // Set initial position (random position within reasonable bounds)
    const randomX = (Math.random() - 0.5) * 10;
    const randomZ = (Math.random() - 0.5) * 10;
    playerMesh.position.set(randomX, 1, randomZ);

    // Ensure the mesh is in the default upright position
    playerMesh.quaternion.identity(); // Reset quaternion to identity first
    playerMesh.rotation.set(0, 0, 0); // Then set all rotation components to zero
    playerMesh.updateMatrix(); // Update the transformation matrix

    console.log(
      `Created new player mesh for ${userId}, rotation: (${playerMesh.rotation.x}, ${playerMesh.rotation.y}, ${playerMesh.rotation.z})`
    );

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

    // Add to players map
    this.players.set(userId, {
      id: userId,
      mesh: playerMesh,
      lastUpdate: performance.now(),
      position: playerMesh.position.clone(),
      rotation: 0,
      currentHealth: 100,
      isDead: false,
      weaponSystem,
    });
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
  public update(delta: number): void {
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

      // Update bullets with collision detection
      player.weaponSystem.updateBullets(delta, this.collisionDetector);
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

  /**
   * Set the collision detector
   */
  public setCollisionDetector(detector: CollisionDetector): void {
    this.collisionDetector = detector;
  }

  /**
   * Handle damage taken by a remote player
   */
  public takeDamage(playerId: string, amount: number): void {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return;

    player.currentHealth = Math.max(0, player.currentHealth - amount);

    // Show damage indicator in HUD
    this.hud.showNotification(
      `damage-${playerId}`,
      "Player Hit",
      `Dealt ${amount} damage`,
      "💥"
    );

    // If player is dead, you could add death handling here
    if (player.currentHealth <= 0) {
      // Apply death animation
      PlayerUtils.handlePlayerDeath(player.mesh);

      // Mark player as dead
      player.isDead = true;
    }
  }

  /**
   * Check if a bullet collides with any remote player
   */
  public checkBulletCollision(bulletPosition: THREE.Vector3): boolean {
    for (const [playerId, player] of this.players) {
      // Get player height using PlayerCollider utility
      const playerHeight = PlayerCollider.getPlayerHeight(player.mesh);

      // Create a collision box for the player using PlayerCollider
      const playerBox = PlayerCollider.createCollisionBox(
        player.mesh.position,
        playerHeight
      );

      // Check if bullet hits player
      if (playerBox.containsPoint(bulletPosition)) {
        // Apply damage to the hit player
        this.takeDamage(playerId, 25); // Using same damage as CollisionSystem
        return true;
      }
    }
    return false;
  }

  /**
   * Handle player status changes (death, respawn)
   */
  private handlePlayerStatusChange(
    userId: string,
    status: "dead" | "alive",
    position?: { x: number; y: number; z: number }
  ): void {
    console.log(`Player status change: ${userId}, status: ${status}`); // Debug log

    const player = this.players.get(userId);

    if (!player) {
      // Player doesn't exist yet, create them if they're alive
      if (status === "alive" && position) {
        console.log(`Creating new player on status change: ${userId}`); // Debug log
        this.addPlayer(userId);
        // Update their position
        this.updatePlayerPosition(userId, position, 0);
      }
      return;
    }

    if (status === "dead") {
      // Apply death animation to existing player
      PlayerUtils.handlePlayerDeath(player.mesh);
      player.isDead = true;

      this.hud.showNotification(
        `status-${userId}`,
        "Player Dieddddddd",
        `Player has dieddddddddd`,
        "💀"
      );
    } else if (status === "alive") {
      // Handle player respawn
      if (player.isDead) {
        console.log(`Respawning dead player: ${userId}`); // Debug log

        // Remove the dead player mesh
        this.scene.remove(player.mesh);
        this.removePlayer(userId);

        // Add the player back with a new mesh
        if (position) {
          this.addPlayer(userId);
          this.updatePlayerPosition(userId, position, 0);

          // Ensure the rotation is properly reset for the new player
          const newPlayer = this.players.get(userId);
          if (newPlayer) {
            console.log(`Resetting rotation for respawned player: ${userId}`); // Debug log

            // Use quaternion to reset rotation completely
            newPlayer.mesh.quaternion.identity();

            // Then set rotation explicitly to ensure all axes are reset
            newPlayer.mesh.rotation.set(0, 0, 0);
            newPlayer.rotation = 0;

            // Force update matrix to ensure changes take effect
            newPlayer.mesh.updateMatrix();
            newPlayer.mesh.updateMatrixWorld(true);

            // Double-check rotation values after reset
            console.log(
              `Player rotation after reset: x=${newPlayer.mesh.rotation.x}, y=${newPlayer.mesh.rotation.y}, z=${newPlayer.mesh.rotation.z}`
            );
          }

          this.hud.showNotification(
            `status-${userId}`,
            "Player Respawned",
            `Player has respawned`,
            "🔄"
          );
        }
      } else {
        // Player was already alive, just ensure rotation is correct
        console.log(`Updating already-alive player: ${userId}`); // Debug log
        player.mesh.quaternion.identity();
        player.mesh.rotation.set(0, 0, 0);
        player.rotation = 0;
        player.mesh.updateMatrix();
        player.mesh.updateMatrixWorld(true);
      }
    }
  }
}
