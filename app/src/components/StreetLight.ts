import * as THREE from "three";
import { attachModel } from "../core/models";
import { lightHaze } from "./LightHaze";
import {
  LAMP_ANGLE,
  LAMP_COLOR,
  LAMP_DISTANCE,
  LAMP_INTENSITY,
  LAMP_PENUMBRA,
  LAMP_SHADOW_MAP_SIZE,
} from "../core/Scene";

// Street light mesh only; its collider is the shared `streetLightBox` in the map.
// The lamp is the scene's key light; its values are tuned in core/Scene.ts.

// Blender timber pole; the runtime light stays aligned with its hanging diffuser.
function createStreetLightModel(): THREE.Group {
  const streetLightGroup = new THREE.Group();

  attachModel(streetLightGroup, "noir-lightpole");

  // Sodium lamp: a downward spot in physical units (candela, decay 2) that
  // throws a warm pool ~7 m wide on the ground.
  const spotlight = new THREE.SpotLight(
    LAMP_COLOR,
    LAMP_INTENSITY,
    LAMP_DISTANCE,
    LAMP_ANGLE,
    LAMP_PENUMBRA,
    2
  );
  spotlight.position.set(1.4, 5.9, 0); // Position at the bulb

  // Target for the spotlight to aim at the ground
  const target = new THREE.Object3D();
  target.position.set(1.4, 0, 0); // Target on the ground directly below the light
  streetLightGroup.add(target);
  spotlight.target = target;

  // Lamps cast shadows: they are the key lights, so crates and cones under
  // them need contact shadows to read as solid.
  spotlight.castShadow = true;
  spotlight.shadow.mapSize.width = LAMP_SHADOW_MAP_SIZE;
  spotlight.shadow.mapSize.height = LAMP_SHADOW_MAP_SIZE;
  spotlight.shadow.camera.near = 0.5;
  spotlight.shadow.camera.far = LAMP_DISTANCE;
  spotlight.shadow.bias = -0.0002;
  spotlight.shadow.normalBias = .035;

  streetLightGroup.add(spotlight);
  const mist = lightHaze(LAMP_COLOR, 5.8, 3.1, .045);
  mist.position.copy(spotlight.position);
  streetLightGroup.add(mist);

  return streetLightGroup;
}

// Add a street light to the scene at the specified position
export function addToScene(
  scene: THREE.Object3D,
  position: THREE.Vector3
): THREE.Group {
  const streetLight = createStreetLightModel();
  streetLight.position.copy(position);
  scene.add(streetLight);
  return streetLight;
}

export const StreetLight = {
  createStreetLightModel,
  addToScene,
};
