import * as THREE from 'three';
import { lightHaze } from './LightHaze';
import { attachModel } from '../core/models';
import { HEADLIGHT_COLOR, HEADLIGHT_INTENSITY, HEADLIGHT_DISTANCE, HEADLIGHT_ANGLE,
  BRAKE_LIGHT_COLOR, BRAKE_LIGHT_INTENSITY, BRAKE_LIGHT_DISTANCE } from '../core/Scene';

/** Blender-authored pickup; gameplay dimensions remain the shared CAR_SIZE. */
function createCarModel(): THREE.Group {
  const car = new THREE.Group();
  attachModel(car, 'noir-pickup');
  for (const x of [-.83, .83]) {
    const beam = new THREE.SpotLight(HEADLIGHT_COLOR, HEADLIGHT_INTENSITY,
      HEADLIGHT_DISTANCE, HEADLIGHT_ANGLE, .85, 2);
    beam.position.set(x, .95, -2.46);
    beam.target.position.set(x, .05, -10);
    car.add(beam, beam.target);
    const mist = lightHaze(HEADLIGHT_COLOR, 6, 1.15, .055);
    mist.position.copy(beam.position);
    mist.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0),
      beam.target.position.clone().sub(beam.position).normalize());
    car.add(mist);
    const tail = new THREE.PointLight(BRAKE_LIGHT_COLOR, BRAKE_LIGHT_INTENSITY, BRAKE_LIGHT_DISTANCE, 2);
    tail.position.set(x, .9, 2.46);
    car.add(tail);
  }
  return car;
}
function addToScene(scene: THREE.Object3D, position: THREE.Vector3): THREE.Group {
  const car = createCarModel();
  car.position.copy(position);
  scene.add(car);
  return car;
}
export const Car = { createCarModel, addToScene };
