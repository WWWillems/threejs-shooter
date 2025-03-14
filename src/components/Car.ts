import * as THREE from "three";

// Create a car model using basic geometry
function createCarModel(): THREE.Group {
  const carGroup = new THREE.Group();

  // Car body - main chassis - increased dimensions
  const bodyGeometry = new THREE.BoxGeometry(2.5, 1.2, 5);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2255bb,
    metalness: 0.6,
    roughness: 0.2,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.7;
  body.castShadow = true;
  body.receiveShadow = true;

  // Create slightly curved hood - adjusted size
  const hoodGeometry = new THREE.BoxGeometry(2.3, 0.15, 1.5);
  const hood = new THREE.Mesh(hoodGeometry, bodyMaterial);
  hood.position.set(0, 1.25, -1.7);
  hood.rotation.x = -0.1; // Slight angle for the hood
  hood.castShadow = true;

  // Car cabin/roof with slightly curved top - adjusted size
  const roofGeometry = new THREE.BoxGeometry(2.3, 0.2, 2.5);
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0x2255bb,
    metalness: 0.7,
    roughness: 0.2,
  });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.position.y = 1.95;
  roof.position.z = -0.5;
  roof.castShadow = true;

  // Add curved roof top - adjusted size
  const roofTopGeometry = new THREE.BoxGeometry(2.2, 0.08, 2.4);
  const roofTop = new THREE.Mesh(roofTopGeometry, roofMaterial);
  roofTop.position.y = 2.1;
  roofTop.position.z = -0.5;
  roofTop.scale.x = 0.92; // More narrower for a better curved look
  roofTop.castShadow = true;

  // Roof supports (pillars) - adjusted height
  const pillarGeometry = new THREE.BoxGeometry(0.12, 0.8, 0.12);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

  // Front pillars - adjusted positions
  const frontLeftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
  frontLeftPillar.position.set(-1.1, 1.65, -1.7);
  const frontRightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
  frontRightPillar.position.set(1.1, 1.65, -1.7);

  // Rear pillars - adjusted positions
  const rearLeftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
  rearLeftPillar.position.set(-1.1, 1.65, 0.7);
  const rearRightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
  rearRightPillar.position.set(1.1, 1.65, 0.7);

  // Improved wheels with rims and tires - adjusted size
  const wheelRadius = 0.5;
  const wheelThickness = 0.25;

  // Tire geometry (black outer part)
  const tireGeometry = new THREE.CylinderGeometry(
    wheelRadius,
    wheelRadius,
    wheelThickness,
    24
  );
  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
  });

  // Rim geometry (silver inner part)
  const rimGeometry = new THREE.CylinderGeometry(
    wheelRadius * 0.6,
    wheelRadius * 0.6,
    wheelThickness + 0.01,
    12
  );
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    metalness: 0.8,
    roughness: 0.2,
  });

  // Create wheel assemblies (tire + rim)
  function createWheel(x: number, y: number, z: number) {
    const wheelGroup = new THREE.Group();

    // Create tire
    const tire = new THREE.Mesh(tireGeometry, tireMaterial);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;

    // Create rim
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.z = Math.PI / 2;

    // Add spokes to the rim
    const spokeGeometry = new THREE.BoxGeometry(wheelRadius * 1.1, 0.02, 0.04);
    const spokeMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 });

    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeometry, spokeMaterial);
      spoke.rotation.z = (i / 5) * Math.PI * 2;
      rim.add(spoke);
    }

    // Add tire and rim to wheel group
    wheelGroup.add(tire);
    wheelGroup.add(rim);

    // Position the wheel
    wheelGroup.position.set(x, y, z);

    return wheelGroup;
  }

  // Create all four wheels - adjusted positions
  const wheelFL = createWheel(-1.3, 0.5, -1.7);
  const wheelFR = createWheel(1.3, 0.5, -1.7);
  const wheelRL = createWheel(-1.3, 0.5, 1.7);
  const wheelRR = createWheel(1.3, 0.5, 1.7);

  // Front bumper - adjusted size and position
  const bumperFGeometry = new THREE.BoxGeometry(2.4, 0.15, 0.4);
  const bumperFMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
  });
  const bumperF = new THREE.Mesh(bumperFGeometry, bumperFMaterial);
  bumperF.position.set(0, 0.35, -2.6);
  bumperF.castShadow = true;

  // Rear bumper - adjusted size and position
  const bumperRGeometry = new THREE.BoxGeometry(2.4, 0.15, 0.4);
  const bumperR = new THREE.Mesh(bumperRGeometry, bumperFMaterial);
  bumperR.position.set(0, 0.35, 2.6);
  bumperR.castShadow = true;

  // Front grille - adjusted size and position
  const grilleGeometry = new THREE.BoxGeometry(1.8, 0.4, 0.05);
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.9,
  });
  const grille = new THREE.Mesh(grilleGeometry, grilleMaterial);
  grille.position.set(0, 0.8, -2.55);

  // License plates
  const plateGeometry = new THREE.BoxGeometry(0.6, 0.2, 0.02);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const frontPlate = new THREE.Mesh(plateGeometry, plateMaterial);
  frontPlate.position.set(0, 0.3, -2.21);
  const rearPlate = new THREE.Mesh(plateGeometry, plateMaterial);
  rearPlate.position.set(0, 0.3, 2.21);

  // Door lines and panels - adjusted dimensions
  const doorLineGeometry = new THREE.BoxGeometry(0.04, 0.8, 2.2);
  const doorLineMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
  });
  const leftDoorLine = new THREE.Mesh(doorLineGeometry, doorLineMaterial);
  leftDoorLine.position.set(-1.255, 0.9, -0.3);
  const rightDoorLine = new THREE.Mesh(doorLineGeometry, doorLineMaterial);
  rightDoorLine.position.set(1.255, 0.9, -0.3);

  // Door panels - adjusted dimensions
  const doorPanelGeometry = new THREE.BoxGeometry(0.06, 0.9, 2.2);
  const doorPanelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e4eaa, // Slightly different blue for contrast
    metalness: 0.6,
    roughness: 0.3,
  });

  // Left door panel - adjusted position
  const leftDoorPanel = new THREE.Mesh(doorPanelGeometry, doorPanelMaterial);
  leftDoorPanel.position.set(-1.28, 0.9, -0.3);

  // Right door panel - adjusted position
  const rightDoorPanel = new THREE.Mesh(doorPanelGeometry, doorPanelMaterial);
  rightDoorPanel.position.set(1.28, 0.9, -0.3);

  // Door handles - adjusted size and position
  const handleGeometry = new THREE.BoxGeometry(0.06, 0.1, 0.25);
  const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    metalness: 0.8,
  });
  const leftHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  leftHandle.position.set(-1.32, 1.0, -0.6);
  const rightHandle = new THREE.Mesh(handleGeometry, handleMaterial);
  rightHandle.position.set(1.32, 1.0, -0.6);

  // Side mirrors
  const mirrorArmGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.2);
  const mirrorFaceGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.03);
  const mirrorMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

  // Left mirror
  const leftMirrorArm = new THREE.Mesh(mirrorArmGeometry, bodyMaterial);
  leftMirrorArm.position.set(-1.025, 1.05, -0.9);
  const leftMirrorFace = new THREE.Mesh(mirrorFaceGeometry, mirrorMaterial);
  leftMirrorFace.position.set(-1.15, 1.05, -1.0);

  // Right mirror
  const rightMirrorArm = new THREE.Mesh(mirrorArmGeometry, bodyMaterial);
  rightMirrorArm.position.set(1.025, 1.05, -0.9);
  const rightMirrorFace = new THREE.Mesh(mirrorFaceGeometry, mirrorMaterial);
  rightMirrorFace.position.set(1.15, 1.05, -1.0);

  // Window material (transparent blue glass)
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.5,
    metalness: 0.2,
  });

  // Windshield (front window) - adjusted size and position
  const windshieldGeometry = new THREE.BoxGeometry(2.2, 1.0, 0.1);
  const windshield = new THREE.Mesh(windshieldGeometry, windowMaterial);
  windshield.position.set(0, 1.7, -1.7);
  windshield.rotation.x = Math.PI / 5; // Steeper angle for the windshield

  // Side windows - left with window frame - adjusted size and position
  const sideWindowGeometry = new THREE.BoxGeometry(0.06, 0.5, 2.2);
  const leftWindow = new THREE.Mesh(sideWindowGeometry, windowMaterial);
  leftWindow.position.set(-1.25, 1.7, -0.4);

  // Window frame - left - adjusted position
  const windowFrameGeometry = new THREE.BoxGeometry(0.08, 0.06, 2.2);
  const windowFrameMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
  });
  const leftWindowTopFrame = new THREE.Mesh(
    windowFrameGeometry,
    windowFrameMaterial
  );
  leftWindowTopFrame.position.set(-1.25, 1.95, -0.4);

  // Side windows - right with window frame - adjusted position
  const rightWindow = new THREE.Mesh(sideWindowGeometry, windowMaterial);
  rightWindow.position.set(1.25, 1.7, -0.4);

  // Window frame - right - adjusted position
  const rightWindowTopFrame = new THREE.Mesh(
    windowFrameGeometry,
    windowFrameMaterial
  );
  rightWindowTopFrame.position.set(1.25, 1.95, -0.4);

  // Rear window - adjusted size and position
  const rearWindowGeometry = new THREE.BoxGeometry(2.0, 0.7, 0.1);
  const rearWindow = new THREE.Mesh(rearWindowGeometry, windowMaterial);
  rearWindow.position.set(0, 1.7, 0.7);
  rearWindow.rotation.x = -Math.PI / 5; // Angle the rear window

  // Headlights - adjusted position
  const headlightGeometry = new THREE.BoxGeometry(0.5, 0.25, 0.1);
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1.0,
  });

  // Left headlight - adjusted position
  const headlightL = new THREE.Mesh(headlightGeometry, headlightMaterial);
  headlightL.position.set(-0.9, 0.8, -2.6);

  // Right headlight - adjusted position
  const headlightR = new THREE.Mesh(headlightGeometry, headlightMaterial);
  headlightR.position.set(0.9, 0.8, -2.6);

  // Add actual light sources for the headlights
  const leftLight = new THREE.SpotLight(0xff0000, 1.5);
  leftLight.position.copy(headlightL.position);
  leftLight.target.position.set(
    headlightL.position.x - 2,
    headlightL.position.y - 0.5,
    headlightL.position.z - 5
  );
  leftLight.angle = Math.PI / 8;
  leftLight.penumbra = 0.2;
  leftLight.decay = 2;
  leftLight.distance = 30;
  leftLight.castShadow = true;
  carGroup.add(leftLight.target);

  const rightLight = new THREE.SpotLight(0xff0000, 1.5);
  rightLight.position.copy(headlightR.position);
  rightLight.target.position.set(
    headlightR.position.x + 2,
    headlightR.position.y - 0.5,
    headlightR.position.z - 5
  );
  rightLight.angle = Math.PI / 8;
  rightLight.penumbra = 0.2;
  rightLight.decay = 2;
  rightLight.distance = 30;
  rightLight.castShadow = true;
  carGroup.add(rightLight.target);

  // Brake lights (rear lights) - adjusted size and position
  const brakeGeometry = new THREE.BoxGeometry(0.4, 0.25, 0.06);
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffcc,
    emissive: 0xffffcc,
    emissiveIntensity: 1.0,
  });

  // Left brake light - adjusted position
  const brakeL = new THREE.Mesh(brakeGeometry, brakeMaterial);
  brakeL.position.set(-0.9, 0.8, 2.6);

  // Right brake light - adjusted position
  const brakeR = new THREE.Mesh(brakeGeometry, brakeMaterial);
  brakeR.position.set(0.9, 0.8, 2.6);

  // Add actual light sources for brake lights
  const leftBrakeLight = new THREE.PointLight(0xffffcc, 0.5);
  leftBrakeLight.position.copy(brakeL.position);
  leftBrakeLight.position.z += 0.1; // Offset slightly to be behind the brake light
  leftBrakeLight.decay = 2;
  leftBrakeLight.distance = 5;

  const rightBrakeLight = new THREE.PointLight(0xffffcc, 0.5);
  rightBrakeLight.position.copy(brakeR.position);
  rightBrakeLight.position.z += 0.1; // Offset slightly to be behind the brake light
  rightBrakeLight.decay = 2;
  rightBrakeLight.distance = 5;

  // Exhaust pipe - adjusted position
  const exhaustGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8);
  const exhaustMaterial = new THREE.MeshStandardMaterial({
    color: 0x777777,
    metalness: 0.7,
    roughness: 0.3,
  });
  const exhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
  exhaust.rotation.z = Math.PI / 2;
  exhaust.position.set(-0.9, 0.3, 2.65);

  // Add all parts to the car group
  carGroup.add(body);
  carGroup.add(hood);
  carGroup.add(roof);
  carGroup.add(roofTop); // Add new roof top part
  carGroup.add(frontLeftPillar);
  carGroup.add(frontRightPillar);
  carGroup.add(rearLeftPillar);
  carGroup.add(rearRightPillar);
  carGroup.add(wheelFL);
  carGroup.add(wheelFR);
  carGroup.add(wheelRL);
  carGroup.add(wheelRR);
  carGroup.add(bumperF);
  carGroup.add(bumperR);
  carGroup.add(grille);
  carGroup.add(frontPlate);
  carGroup.add(rearPlate);
  carGroup.add(leftDoorPanel); // Add new door panel
  carGroup.add(rightDoorPanel); // Add new door panel
  carGroup.add(leftDoorLine);
  carGroup.add(rightDoorLine);
  carGroup.add(leftHandle);
  carGroup.add(rightHandle);
  carGroup.add(leftMirrorArm);
  carGroup.add(leftMirrorFace);
  carGroup.add(rightMirrorArm);
  carGroup.add(rightMirrorFace);
  carGroup.add(windshield);
  carGroup.add(leftWindow);
  carGroup.add(rightWindow);
  carGroup.add(leftWindowTopFrame); // Add window frame
  carGroup.add(rightWindowTopFrame); // Add window frame
  carGroup.add(rearWindow);
  carGroup.add(headlightL);
  carGroup.add(headlightR);
  carGroup.add(leftLight);
  carGroup.add(rightLight);
  carGroup.add(brakeL);
  carGroup.add(brakeR);
  carGroup.add(leftBrakeLight);
  carGroup.add(rightBrakeLight);
  carGroup.add(exhaust);

  return carGroup;
}

// Add a car to the scene at the specified position
export function addToScene(
  scene: THREE.Scene,
  position: THREE.Vector3
): THREE.Group {
  const car = createCarModel();
  car.position.copy(position);
  scene.add(car);
  return car;
}

export const Car = {
  createCarModel,
  addToScene,
};
