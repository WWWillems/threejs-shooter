import * as THREE from "three";
import { HealthPickup } from "./HealthPickup";
import { AmmoPickup } from "./AmmoPickup";
import { WeaponType } from "./Weapon";
import type { PickupManager } from "./PickupManager";

// Define wooden crate collision dimensions for collision detection
export interface WoodenCrateCollisionInfo {
  dimensions: THREE.Vector3;
  heightOffset: number;
}

// Define interface for destructible crate
export interface DestructibleCrate extends THREE.Group {
  crateSize?: number;
  health?: number;
  maxHealth?: number;
  takeDamage?: (amount: number) => boolean; // Returns true if destroyed
  isDestroyed?: boolean;
}

/**
 * Load textures for wooden crates
 */
const textureLoader = new THREE.TextureLoader();

// Load once and reuse these textures
const woodTexture = textureLoader.load(
  "/textures/crate/Wood_Crate_001_basecolor.jpg"
);
const woodNormalMap = textureLoader.load(
  "/textures/crate/Wood_Crate_001_normal.jpg"
);
const woodRoughnessMap = textureLoader.load(
  "/textures/crate/Wood_Crate_001_roughness.jpg"
);
const woodHeightMap = textureLoader.load(
  "/textures/crate/Wood_Crate_001_height.png"
);
const woodAOMap = textureLoader.load(
  "/textures/crate/Wood_Crate_001_ambientOcclusion.jpg"
);

// Configure texture properties
woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
woodNormalMap.wrapS = woodNormalMap.wrapT = THREE.RepeatWrapping;
woodRoughnessMap.wrapS = woodRoughnessMap.wrapT = THREE.RepeatWrapping;
woodHeightMap.wrapS = woodHeightMap.wrapT = THREE.RepeatWrapping;
woodAOMap.wrapS = woodAOMap.wrapT = THREE.RepeatWrapping;

/**
 * Creates a wooden crate model with texture and details
 */
function createWoodenCrateModel(size = 1): THREE.Group {
  const crateGroup = new THREE.Group();

  // Create the main crate box
  const crateGeometry = new THREE.BoxGeometry(size, size, size);

  // Create texture-based material for the wooden crate
  const crateMaterial = new THREE.MeshStandardMaterial({
    map: woodTexture,
    normalMap: woodNormalMap,
    roughnessMap: woodRoughnessMap,
    displacementMap: woodHeightMap,
    displacementScale: 0.01, // Subtle displacement effect
    aoMap: woodAOMap,
    normalScale: new THREE.Vector2(1, 1),
    color: 0x8a6240, // Warm brown color to enhance the wood appearance
    roughness: 0.9,
    metalness: 0.0,
  });

  // Create the main crate mesh
  const crateMesh = new THREE.Mesh(crateGeometry, crateMaterial);
  crateMesh.castShadow = true;
  crateMesh.receiveShadow = true;

  // Add metal frame edges to the crate for more realism
  const addMetalEdges = () => {
    const edgeWidth = 0.03 * size;
    const edgeGeometry = new THREE.BoxGeometry(
      size + 0.01,
      edgeWidth,
      edgeWidth
    );
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.5,
      metalness: 0.8,
    });

    // Create the 12 edges of the cube
    // 4 edges along the top
    const topEdge1 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    topEdge1.position.set(0, size / 2, size / 2 - edgeWidth / 2);
    crateGroup.add(topEdge1);

    const topEdge2 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    topEdge2.position.set(0, size / 2, -size / 2 + edgeWidth / 2);
    crateGroup.add(topEdge2);

    const topEdge3 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    topEdge3.rotation.y = Math.PI / 2;
    topEdge3.position.set(size / 2 - edgeWidth / 2, size / 2, 0);
    crateGroup.add(topEdge3);

    const topEdge4 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    topEdge4.rotation.y = Math.PI / 2;
    topEdge4.position.set(-size / 2 + edgeWidth / 2, size / 2, 0);
    crateGroup.add(topEdge4);

    // 4 edges along the bottom
    const bottomEdge1 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    bottomEdge1.position.set(0, -size / 2, size / 2 - edgeWidth / 2);
    crateGroup.add(bottomEdge1);

    const bottomEdge2 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    bottomEdge2.position.set(0, -size / 2, -size / 2 + edgeWidth / 2);
    crateGroup.add(bottomEdge2);

    const bottomEdge3 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    bottomEdge3.rotation.y = Math.PI / 2;
    bottomEdge3.position.set(size / 2 - edgeWidth / 2, -size / 2, 0);
    crateGroup.add(bottomEdge3);

    const bottomEdge4 = new THREE.Mesh(edgeGeometry, edgeMaterial);
    bottomEdge4.rotation.y = Math.PI / 2;
    bottomEdge4.position.set(-size / 2 + edgeWidth / 2, -size / 2, 0);
    crateGroup.add(bottomEdge4);

    // 4 vertical edges
    const vertEdgeGeometry = new THREE.BoxGeometry(
      edgeWidth,
      size + 0.01,
      edgeWidth
    );

    const vertEdge1 = new THREE.Mesh(vertEdgeGeometry, edgeMaterial);
    vertEdge1.position.set(
      size / 2 - edgeWidth / 2,
      0,
      size / 2 - edgeWidth / 2
    );
    crateGroup.add(vertEdge1);

    const vertEdge2 = new THREE.Mesh(vertEdgeGeometry, edgeMaterial);
    vertEdge2.position.set(
      size / 2 - edgeWidth / 2,
      0,
      -size / 2 + edgeWidth / 2
    );
    crateGroup.add(vertEdge2);

    const vertEdge3 = new THREE.Mesh(vertEdgeGeometry, edgeMaterial);
    vertEdge3.position.set(
      -size / 2 + edgeWidth / 2,
      0,
      size / 2 - edgeWidth / 2
    );
    crateGroup.add(vertEdge3);

    const vertEdge4 = new THREE.Mesh(vertEdgeGeometry, edgeMaterial);
    vertEdge4.position.set(
      -size / 2 + edgeWidth / 2,
      0,
      -size / 2 + edgeWidth / 2
    );
    crateGroup.add(vertEdge4);
  };

  // Add metal corner brackets for more detail
  const addCornerBrackets = () => {
    const bracketSize = 0.08 * size;
    const bracketThickness = 0.03 * size;
    const bracketMaterial = new THREE.MeshStandardMaterial({
      color: 0x505050,
      roughness: 0.5,
      metalness: 0.7,
    });

    // Helper to create a corner bracket
    const createBracket = (x: number, y: number, z: number, rotY: number) => {
      const bracketGroup = new THREE.Group();

      // L-shaped bracket plates
      const plate1Geometry = new THREE.BoxGeometry(
        bracketSize,
        bracketThickness,
        bracketSize / 2
      );
      const plate1 = new THREE.Mesh(plate1Geometry, bracketMaterial);
      plate1.position.set(bracketSize / 4, 0, 0);

      const plate2Geometry = new THREE.BoxGeometry(
        bracketSize / 2,
        bracketThickness,
        bracketSize
      );
      const plate2 = new THREE.Mesh(plate2Geometry, bracketMaterial);
      plate2.position.set(0, 0, bracketSize / 4);

      bracketGroup.add(plate1);
      bracketGroup.add(plate2);

      // Position and rotate the bracket
      bracketGroup.position.set(x, y, z);
      bracketGroup.rotation.y = rotY;

      return bracketGroup;
    };

    // Create brackets at each corner
    const offsetFromEdge = size / 2 - bracketSize / 2;

    // Top brackets
    crateGroup.add(
      createBracket(
        offsetFromEdge,
        size / 2 + bracketThickness / 2,
        offsetFromEdge,
        0
      )
    );
    crateGroup.add(
      createBracket(
        -offsetFromEdge,
        size / 2 + bracketThickness / 2,
        offsetFromEdge,
        Math.PI / 2
      )
    );
    crateGroup.add(
      createBracket(
        -offsetFromEdge,
        size / 2 + bracketThickness / 2,
        -offsetFromEdge,
        Math.PI
      )
    );
    crateGroup.add(
      createBracket(
        offsetFromEdge,
        size / 2 + bracketThickness / 2,
        -offsetFromEdge,
        -Math.PI / 2
      )
    );

    // Bottom brackets
    crateGroup.add(
      createBracket(
        offsetFromEdge,
        -size / 2 - bracketThickness / 2,
        offsetFromEdge,
        0
      )
    );
    crateGroup.add(
      createBracket(
        -offsetFromEdge,
        -size / 2 - bracketThickness / 2,
        offsetFromEdge,
        Math.PI / 2
      )
    );
    crateGroup.add(
      createBracket(
        -offsetFromEdge,
        -size / 2 - bracketThickness / 2,
        -offsetFromEdge,
        Math.PI
      )
    );
    crateGroup.add(
      createBracket(
        offsetFromEdge,
        -size / 2 - bracketThickness / 2,
        -offsetFromEdge,
        -Math.PI / 2
      )
    );
  };

  // Add details to make the crate more realistic
  addMetalEdges();
  addCornerBrackets();

  // Add the main crate mesh to the group
  crateGroup.add(crateMesh);

  return crateGroup;
}

/**
 * Get collision dimensions for wooden crate
 */
function getCollisionDimensions(size = 1): WoodenCrateCollisionInfo {
  return {
    dimensions: new THREE.Vector3(size, size, size),
    heightOffset: size / 2, // Center of the collision box
  };
}

/**
 * Adds a destructible wooden crate to the scene
 */
function addToScene(
  scene: THREE.Scene,
  position: THREE.Vector3,
  size = 1,
  rotation = 0,
  pickupManager?: PickupManager
): DestructibleCrate {
  const crateGroup = createWoodenCrateModel(size);
  crateGroup.position.copy(position);
  crateGroup.rotation.y = rotation;
  scene.add(crateGroup);

  // Add destructible properties
  const crate = crateGroup as DestructibleCrate;
  crate.crateSize = size;
  crate.maxHealth = 100;
  crate.health = 100;
  crate.isDestroyed = false;

  // Add damage function
  crate.takeDamage = function (amount: number): boolean {
    if (this.isDestroyed) return true;

    if (this.health !== undefined && this.maxHealth !== undefined) {
      this.health = Math.max(0, this.health - amount);

      // Visual feedback - slightly darken crate as it takes damage
      const darkFactor = this.health / this.maxHealth;
      this.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material instanceof THREE.MeshStandardMaterial) {
            // Adjust material properties based on damage
            child.material.emissive.setRGB(0.3 * (1 - darkFactor), 0, 0);
            child.material.color.multiplyScalar(0.7 + 0.3 * darkFactor);
          }
        }
      });

      // Check if destroyed
      if (this.health <= 0) {
        this.isDestroyed = true;

        // Create destruction effect (particles)
        createDestructionEffect(scene, this.position, size);

        // Random chance to spawn pickup (50% chance)
        if (Math.random() < 0.5) {
          // Randomly choose between health pickup (50%) or ammo pickup (50%)
          if (pickupManager) {
            if (Math.random() < 0.5) {
              // Create health pickup
              pickupManager.createHealthPickup(this.position.clone(), 25);
            } else {
              // Create ammo pickup with random weapon type
              const weaponTypes = [
                WeaponType.PISTOL,
                WeaponType.RIFLE,
                WeaponType.SHOTGUN,
                WeaponType.SNIPER,
              ];
              const randomWeaponType =
                weaponTypes[Math.floor(Math.random() * weaponTypes.length)];
              pickupManager.createAmmoPickup(
                this.position.clone(),
                randomWeaponType,
                30
              );
            }
          }
        }

        // Remove from scene after a slight delay
        setTimeout(() => {
          scene.remove(this);
        }, 100);

        return true;
      }
    }

    return false;
  };

  return crate;
}

/**
 * Creates a destruction effect when a crate is destroyed
 */
function createDestructionEffect(
  scene: THREE.Scene,
  position: THREE.Vector3,
  size: number
): void {
  // Create wood particle geometry
  const particleCount = 20 + Math.floor(size * 10);
  const particles = new THREE.Group();

  // Wood chip material
  const woodMaterial = new THREE.MeshStandardMaterial({
    map: woodTexture,
    color: 0xa06732,
    roughness: 1,
  });

  // Create random wood chips
  for (let i = 0; i < particleCount; i++) {
    // Random size for each particle
    const chipSize = (Math.random() * 0.1 + 0.05) * size;

    // Create a cube or rectangular chip
    const geometry = new THREE.BoxGeometry(
      chipSize * (Math.random() * 0.5 + 0.5),
      chipSize * (Math.random() * 0.3 + 0.2),
      chipSize * (Math.random() * 0.5 + 0.5)
    );

    const chip = new THREE.Mesh(geometry, woodMaterial);

    // Set random position within crate bounds
    const offset = size * 0.5;
    chip.position.set(
      position.x + (Math.random() - 0.5) * offset,
      position.y + (Math.random() - 0.5) * offset,
      position.z + (Math.random() - 0.5) * offset
    );

    // Set random rotation
    chip.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    // Set velocity for animation
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 5,
      Math.random() * 5 + 2,
      (Math.random() - 0.5) * 5
    );

    // Attach velocity as user data
    chip.userData.velocity = velocity;
    chip.userData.rotationSpeed = new THREE.Vector3(
      Math.random() * 0.2 - 0.1,
      Math.random() * 0.2 - 0.1,
      Math.random() * 0.2 - 0.1
    );

    particles.add(chip);
  }

  scene.add(particles);

  // Store creation time
  particles.userData.creationTime = Date.now();

  // Animate particles
  function animateParticles() {
    const elapsedTime = (Date.now() - particles.userData.creationTime) / 1000;

    if (elapsedTime > 2) {
      // Remove particles after 2 seconds
      scene.remove(particles);
      return;
    }

    for (const chip of particles.children) {
      // Apply gravity
      chip.userData.velocity.y -= 9.8 * 0.016; // gravity * deltaTime

      // Update position
      chip.position.x += chip.userData.velocity.x * 0.016;
      chip.position.y += chip.userData.velocity.y * 0.016;
      chip.position.z += chip.userData.velocity.z * 0.016;

      // Update rotation
      chip.rotation.x += chip.userData.rotationSpeed.x;
      chip.rotation.y += chip.userData.rotationSpeed.y;
      chip.rotation.z += chip.userData.rotationSpeed.z;

      // Ground collision
      if (chip.position.y < 0) {
        chip.position.y = 0;
        chip.userData.velocity.y *= -0.3; // bounce with damping
        chip.userData.velocity.x *= 0.8; // friction
        chip.userData.velocity.z *= 0.8; // friction
      }
    }

    requestAnimationFrame(animateParticles);
  }

  animateParticles();
}

// Export module functions
export const WoodenCrate = {
  addToScene,
  getCollisionDimensions,
  createDestructionEffect,
};
