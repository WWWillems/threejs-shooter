import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";

export class ShopBuilding {
  private shopMesh: THREE.Group;
  private collisionBoxes: THREE.Box3[] = [];
  private boundingBox: THREE.Box3;

  constructor(
    position: THREE.Vector3,
    private scene: THREE.Scene,
    private collisionSystem?: CollisionSystem
  ) {
    this.shopMesh = new THREE.Group();
    this.boundingBox = new THREE.Box3();

    // Create the shop building
    this.createShopBuilding();

    // Position the shop
    this.shopMesh.position.copy(position);

    // Add to scene
    this.scene.add(this.shopMesh);

    // Add collision objects if collision system is provided
    if (this.collisionSystem) {
      this.addToCollisionSystem();
    }
  }

  private createShopBuilding(): void {
    // 1. Create the main building structure (rectangular shape)
    const buildingWidth = 10;
    const buildingDepth = 8;
    const buildingHeight = 4;

    // Main building geometry
    const buildingGeometry = new THREE.BoxGeometry(
      buildingWidth,
      buildingHeight,
      buildingDepth
    );
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9c7ad, // Warm beige/tan color
      roughness: 0.9,
      metalness: 0.0,
    });

    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
    building.position.y = buildingHeight / 2;
    building.castShadow = true;
    building.receiveShadow = true;
    this.shopMesh.add(building);

    // Add to collision objects
    const buildingBox = new THREE.Box3().setFromObject(building);
    this.collisionBoxes.push(buildingBox);

    // 2. Create a roof (triangular prism)
    const roofHeight = 1.5;

    // Create a basic geometry for the roof
    const roofWidth = buildingWidth + 0.6;
    const roofDepth = buildingDepth + 0.6;

    // Create custom geometry for pitched roof
    const roofGeometry = new THREE.BufferGeometry();

    // Define the vertices for a pitched roof
    const vertices = new Float32Array([
      // Front triangular face
      -roofWidth / 2,
      0,
      -roofDepth / 2,
      roofWidth / 2,
      0,
      -roofDepth / 2,
      0,
      roofHeight,
      -roofDepth / 2,

      // Back triangular face
      -roofWidth / 2,
      0,
      roofDepth / 2,
      roofWidth / 2,
      0,
      roofDepth / 2,
      0,
      roofHeight,
      roofDepth / 2,

      // Bottom face (rectangle)
      -roofWidth / 2,
      0,
      -roofDepth / 2,
      roofWidth / 2,
      0,
      -roofDepth / 2,
      roofWidth / 2,
      0,
      roofDepth / 2,
      -roofWidth / 2,
      0,
      roofDepth / 2,

      // Left face (triangle)
      -roofWidth / 2,
      0,
      -roofDepth / 2,
      -roofWidth / 2,
      0,
      roofDepth / 2,
      0,
      roofHeight,
      roofDepth / 2,
      0,
      roofHeight,
      -roofDepth / 2,

      // Right face (triangle)
      roofWidth / 2,
      0,
      -roofDepth / 2,
      roofWidth / 2,
      0,
      roofDepth / 2,
      0,
      roofHeight,
      roofDepth / 2,
      0,
      roofHeight,
      -roofDepth / 2,
    ]);

    // Define indices to create triangles from vertices
    const indices = [
      // Front triangle
      0, 1, 2,

      // Back triangle
      3, 5, 4,

      // Bottom face (two triangles)
      6, 7, 8, 6, 8, 9,

      // Left face (two triangles)
      10, 12, 13, 10, 11, 12,

      // Right face (two triangles)
      14, 17, 16, 14, 16, 15,
    ];

    roofGeometry.setIndex(indices);
    roofGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(vertices, 3)
    );
    roofGeometry.computeVertexNormals();

    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513, // Saddle brown - more realistic roof tile color
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    // Position the roof on top of the building
    roof.position.set(0, buildingHeight, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.shopMesh.add(roof);

    // Add to collision objects - Roof has complex geometry, so we'll simplify with a box
    const roofBox = new THREE.Box3().setFromObject(roof);
    this.collisionBoxes.push(roofBox);

    // 3. Create a door
    const doorWidth = 1.5;
    const doorHeight = 2.2;
    const doorGeometry = new THREE.PlaneGeometry(doorWidth, doorHeight);
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d2817, // Darker, richer brown
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, doorHeight / 2, buildingDepth / 2 + 0.01);
    door.castShadow = false;
    door.receiveShadow = true;
    this.shopMesh.add(door);

    // 4. Create windows
    const windowSize = 1.2;
    const windowGeometry = new THREE.PlaneGeometry(windowSize, windowSize);
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: 0xc7e6ff, // Very light blue - more like real glass
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.6, // More transparent like real glass
      side: THREE.DoubleSide,
    });

    // Create window frames
    const frameSize = windowSize + 0.2;
    const frameThickness = 0.15;
    const frameGeometry = new THREE.BoxGeometry(
      frameSize,
      frameSize,
      frameThickness
    );
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x5c402a, // Medium brown wood tone
      roughness: 0.8,
      metalness: 0.05,
    });

    // Front window (left side of door)
    const frontWindow1 = new THREE.Mesh(windowGeometry, windowMaterial);
    frontWindow1.position.set(-2, 2, buildingDepth / 2 + 0.05); // Increased offset
    frontWindow1.castShadow = false;
    frontWindow1.receiveShadow = true;
    this.shopMesh.add(frontWindow1);

    // Frame for front window 1
    const frontFrame1 = new THREE.Mesh(frameGeometry, frameMaterial);
    frontFrame1.position.set(-2, 2, buildingDepth / 2 + 0.02);
    frontFrame1.castShadow = true;
    frontFrame1.receiveShadow = true;
    this.shopMesh.add(frontFrame1);

    // Front window (right side of door)
    const frontWindow2 = new THREE.Mesh(windowGeometry, windowMaterial);
    frontWindow2.position.set(2, 2, buildingDepth / 2 + 0.05); // Increased offset
    frontWindow2.castShadow = false;
    frontWindow2.receiveShadow = true;
    this.shopMesh.add(frontWindow2);

    // Frame for front window 2
    const frontFrame2 = new THREE.Mesh(frameGeometry, frameMaterial);
    frontFrame2.position.set(2, 2, buildingDepth / 2 + 0.02);
    frontFrame2.castShadow = true;
    frontFrame2.receiveShadow = true;
    this.shopMesh.add(frontFrame2);

    // Side windows
    const sideWindow1 = new THREE.Mesh(windowGeometry, windowMaterial);
    sideWindow1.position.set(buildingWidth / 2 + 0.05, 2, 0); // Increased offset
    sideWindow1.rotation.y = Math.PI / 2;
    sideWindow1.castShadow = false;
    sideWindow1.receiveShadow = true;
    this.shopMesh.add(sideWindow1);

    // Frame for side window 1
    const sideFrame1 = new THREE.Mesh(frameGeometry, frameMaterial);
    sideFrame1.position.set(buildingWidth / 2 + 0.02, 2, 0);
    sideFrame1.rotation.y = Math.PI / 2;
    sideFrame1.castShadow = true;
    sideFrame1.receiveShadow = true;
    this.shopMesh.add(sideFrame1);

    const sideWindow2 = new THREE.Mesh(windowGeometry, windowMaterial);
    sideWindow2.position.set(-buildingWidth / 2 - 0.05, 2, 0); // Increased offset
    sideWindow2.rotation.y = -Math.PI / 2;
    sideWindow2.castShadow = false;
    sideWindow2.receiveShadow = true;
    this.shopMesh.add(sideWindow2);

    // Frame for side window 2
    const sideFrame2 = new THREE.Mesh(frameGeometry, frameMaterial);
    sideFrame2.position.set(-buildingWidth / 2 - 0.02, 2, 0);
    sideFrame2.rotation.y = -Math.PI / 2;
    sideFrame2.castShadow = true;
    sideFrame2.receiveShadow = true;
    this.shopMesh.add(sideFrame2);

    // 5. Create a small sign
    const signWidth = 3.5;
    const signHeight = 1.2;
    const signGeometry = new THREE.BoxGeometry(signWidth, signHeight, 0.2);
    const signMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfd3a9, // Muted tan/parchment color
      roughness: 0.6,
      metalness: 0.1,
    });

    const sign = new THREE.Mesh(signGeometry, signMaterial);
    sign.position.set(0, buildingHeight + 0.5, buildingDepth / 2 + 0.3);
    sign.castShadow = true;
    sign.receiveShadow = false;
    this.shopMesh.add(sign);

    // 6. Add a small step/entryway in front of the door
    const stepWidth = 2;
    const stepDepth = 0.5;
    const stepHeight = 0.2;

    const stepGeometry = new THREE.BoxGeometry(
      stepWidth,
      stepHeight,
      stepDepth
    );
    const stepMaterial = new THREE.MeshStandardMaterial({
      color: 0x7d7d7d, // More natural concrete gray
      roughness: 0.9,
      metalness: 0.0,
    });

    const step = new THREE.Mesh(stepGeometry, stepMaterial);
    step.position.set(0, stepHeight / 2, buildingDepth / 2 + stepDepth / 2);
    step.castShadow = true;
    step.receiveShadow = true;
    this.shopMesh.add(step);

    // 7. Add parking space next to the building
    this.createParkingSpace(buildingWidth, buildingDepth);

    // Update the bounding box of the entire shop
    this.boundingBox.setFromObject(this.shopMesh);
  }

  private createParkingSpace(
    buildingWidth: number,
    buildingDepth: number
  ): void {
    // Create parking area on the right side of the building
    const parkingWidth = 8;
    const parkingDepth = buildingDepth; // Reduced from 10 to 6 to make parking spaces shorter
    const parkingOffset = 2; // Space between building and parking

    // Base asphalt/concrete for parking area
    const parkingGeometry = new THREE.PlaneGeometry(parkingWidth, parkingDepth);
    const parkingMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444, // Dark gray for asphalt
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const parkingArea = new THREE.Mesh(parkingGeometry, parkingMaterial);
    parkingArea.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    parkingArea.position.set(
      buildingWidth / 2 + parkingOffset + parkingWidth / 2,
      0.01, // Slightly above ground to avoid z-fighting
      0
    );
    parkingArea.receiveShadow = true;
    this.shopMesh.add(parkingArea);

    // Add parking lines
    const lineWidth = 0.2;
    //const lineLength = 4;
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, // White for parking lines
      side: THREE.DoubleSide,
    });

    // Create 3 parking spaces
    const spacesCount = 3;
    const spaceWidth = parkingWidth / spacesCount;

    // Parking area position (center point)
    const parkingX = buildingWidth / 2 + parkingOffset + parkingWidth / 2;
    const parkingZ = 0;

    // Calculate the left edge of the parking area
    const leftEdge = parkingX - parkingWidth / 2;

    // Draw the outer border of the parking area

    // Left vertical line (along entire parking area)
    const leftLineGeometry = new THREE.PlaneGeometry(lineWidth, parkingDepth);
    const leftLine = new THREE.Mesh(leftLineGeometry, lineMaterial);
    leftLine.rotation.x = -Math.PI / 2;
    leftLine.position.set(leftEdge, 0.02, parkingZ);
    this.shopMesh.add(leftLine);

    // Right vertical line (along entire parking area)
    const rightLineGeometry = new THREE.PlaneGeometry(lineWidth, parkingDepth);
    const rightLine = new THREE.Mesh(rightLineGeometry, lineMaterial);
    rightLine.rotation.x = -Math.PI / 2;
    rightLine.position.set(leftEdge + parkingWidth, 0.02, parkingZ);
    this.shopMesh.add(rightLine);

    // Top horizontal line
    const topLineGeometry = new THREE.PlaneGeometry(parkingWidth, lineWidth);
    const topLine = new THREE.Mesh(topLineGeometry, lineMaterial);
    topLine.rotation.x = -Math.PI / 2;
    topLine.position.set(parkingX, 0.02, parkingZ - parkingDepth / 2);
    this.shopMesh.add(topLine);

    // Bottom horizontal line
    const bottomLineGeometry = new THREE.PlaneGeometry(parkingWidth, lineWidth);
    const bottomLine = new THREE.Mesh(bottomLineGeometry, lineMaterial);
    bottomLine.rotation.x = -Math.PI / 2;
    bottomLine.position.set(parkingX, 0.02, parkingZ + parkingDepth / 2);
    this.shopMesh.add(bottomLine);

    // Draw internal divider lines for individual parking spaces
    for (let i = 1; i < spacesCount; i++) {
      const dividerGeometry = new THREE.PlaneGeometry(lineWidth, parkingDepth);
      const divider = new THREE.Mesh(dividerGeometry, lineMaterial);
      divider.rotation.x = -Math.PI / 2;
      divider.position.set(leftEdge + i * spaceWidth, 0.02, parkingZ);
      this.shopMesh.add(divider);
    }
  }

  private addToCollisionSystem(): void {
    if (this.collisionSystem) {
      // Add each collision box to the collision system
      for (const box of this.collisionBoxes) {
        // Update the bounding box based on the current world position
        const worldBoundingBox = new THREE.Box3().copy(box);
        worldBoundingBox.translate(this.shopMesh.position);

        // Add to collision system
        this.collisionSystem.addCustomObstacle(worldBoundingBox);
      }

      // Also add the entire building's bounding box for good measure
      const entireBuildingBox = new THREE.Box3().copy(this.boundingBox);
      entireBuildingBox.translate(this.shopMesh.position);
      this.collisionSystem.addCustomObstacle(entireBuildingBox);
    }
  }

  public dispose(): void {
    // Remove from scene
    this.scene.remove(this.shopMesh);

    // Note: The collision system doesn't have a method to remove custom obstacles
    // If that's needed, it would require an update to the CollisionSystem class

    // Dispose geometries and materials
    this.shopMesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          // Use for...of instead of forEach
          for (const material of child.material) {
            material.dispose();
          }
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
