import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CRATE_MAX_HP } from "@threejs-shooter/shared";

/**
 * A crate mesh that mirrors server state. The server owns crate HP; the
 * client only shows damage (`applyServerHp`) and removes destroyed crates
 * (`destroy`).
 */
export interface DestructibleCrate extends THREE.Group {
  /** Id from the shared map layout; the server refers to crates by this. */
  crateId?: string;
  crateSize?: number;
  health?: number;
  maxHealth?: number;
  /** Show the damage tint for a server-reported HP value. */
  applyServerHp?: (hp: number) => void;
  /** Play the destruction effect and remove the crate from the scene. */
  destroy?: (withEffect?: boolean) => void;
  isDestroyed?: boolean;
}

/**
 * The crate is a 1 m cube modelled in Blender (`assets/blender/crate.blend`)
 * and exported without images to `app/public/models/crate.glb`. Its wood
 * parts use the material slot `crate-planks`; the client attaches the
 * generated `crate-planks` texture set itself so the maps can be re-derived
 * without re-exporting the model.
 */
const CRATE_MODEL_URL = "/models/crate.glb";
const PLANKS_TEXTURE_DIR = "/textures/crate-planks";
const PLANKS_MATERIAL_NAME = "crate-planks";

const textureLoader = new THREE.TextureLoader();

function loadPlankMap(suffix: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const texture = textureLoader.load(`${PLANKS_TEXTURE_DIR}/crate-planks_${suffix}`);
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  return texture;
}

// Load once and reuse these textures
const plankBaseColor = loadPlankMap("basecolor.jpg", THREE.SRGBColorSpace);
const plankRoughness = loadPlankMap("roughness.jpg", THREE.NoColorSpace);
const plankNormal = loadPlankMap("normal.png", THREE.NoColorSpace);
const plankAO = loadPlankMap("ao.jpg", THREE.NoColorSpace);

/**
 * Shared source material; every crate gets its own clone so damage tints do not leak.
 */
const plankMaterial = new THREE.MeshStandardMaterial({
  map: plankBaseColor,
  roughnessMap: plankRoughness,
  normalMap: plankNormal,
  normalScale: new THREE.Vector2(1, 1),
  aoMap: plankAO,
  metalness: 0,
});

/** The GLB is fetched once; each crate clones the loaded scene. */
const crateModel: Promise<THREE.Group> = new GLTFLoader()
  .loadAsync(CRATE_MODEL_URL)
  .then((gltf) => gltf.scene);

/**
 * Clone the loaded crate model with per-instance materials, shadows enabled
 * and the generated plank texture set attached to the wood parts.
 */
function instantiateCrateModel(source: THREE.Group, size: number): THREE.Group {
  const model = source.clone(true);
  model.scale.setScalar(size);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const material = child.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    child.material =
      material.name.replace(/\.\d+$/, '') === PLANKS_MATERIAL_NAME ? plankMaterial.clone() : material.clone();
    child.userData.baseColor = child.material.color.clone();
  });
  return model;
}

/**
 * Adds a destructible wooden crate to the scene. The group is returned
 * immediately; the model is attached once the GLB has loaded.
 */
function addToScene(
  scene: THREE.Scene,
  position: THREE.Vector3,
  size = 1,
  rotation = 0,
  crateId?: string
): DestructibleCrate {
  const crateGroup = new THREE.Group();
  crateGroup.position.copy(position);
  crateGroup.rotation.y = rotation;
  scene.add(crateGroup);

  const crate = crateGroup as DestructibleCrate;
  crate.crateId = crateId;
  crate.crateSize = size;
  crate.maxHealth = CRATE_MAX_HP;
  crate.health = CRATE_MAX_HP;
  crate.isDestroyed = false;

  crate.applyServerHp = function (hp: number): void {
    if (this.isDestroyed || this.maxHealth === undefined) return;
    this.health = Math.max(0, hp);

    // Damage darkens the wood without adding light to a night scene.
    // Colours are set absolutely so repeated updates do not compound.
    const intact = this.health / this.maxHealth;
    this.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        child.material.emissive.setRGB(0, 0, 0);
        const base: THREE.Color | undefined = child.userData.baseColor;
        if (base) {
          child.material.color.copy(base).multiplyScalar(0.7 + 0.3 * intact);
        }
      }
    });
  };

  crate.destroy = function (withEffect = true): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.health = 0;
    if (withEffect) createDestructionEffect(scene, this.position, size);
    scene.remove(this);
  };

  void crateModel.then((source) => {
    if (crate.isDestroyed) return;
    crate.add(instantiateCrateModel(source, size));
    // Re-apply any damage reported while the model was still loading.
    if (crate.health !== undefined && crate.health < CRATE_MAX_HP) {
      crate.applyServerHp?.(crate.health);
    }
  });

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
    map: plankBaseColor,
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
  createDestructionEffect,
};
