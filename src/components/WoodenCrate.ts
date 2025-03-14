import * as THREE from "three";

// Define wooden crate collision dimensions for collision detection
export interface WoodenCrateCollisionInfo {
  dimensions: THREE.Vector3;
  heightOffset: number;
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
 * Add a wooden crate to the scene at the specified position
 */
function addToScene(
  scene: THREE.Scene,
  position: THREE.Vector3,
  size = 1,
  rotation = 0
): THREE.Group {
  const crate = createWoodenCrateModel(size);
  crate.position.copy(position);
  crate.rotation.y = rotation; // Allow rotation for variety
  scene.add(crate);
  return crate;
}

export const WoodenCrate = {
  createWoodenCrateModel,
  addToScene,
  getCollisionDimensions,
};
