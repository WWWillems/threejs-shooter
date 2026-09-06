import * as THREE from "three";

/** Widest pan we ever apply; full hard-panning sounds wrong for an isometric view. */
const MAX_PAN = 0.7;

const view = new THREE.Vector3();

/**
 * Distance attenuation: 1 within `ref`, smooth quadratic falloff to 0 at `max`.
 * Pure and unit-agnostic (world units), so both ends of the game can agree on it.
 */
export function attenuationGain(distance: number, ref = 4, max = 40): number {
  if (distance <= ref) return 1;
  if (distance >= max) return 0;
  const t = (distance - ref) / (max - ref);
  const remaining = 1 - t;
  return remaining * remaining;
}

/**
 * Stereo pan from where `worldPos` lands on screen: -MAX_PAN at the left edge,
 * +MAX_PAN at the right, 0 on the camera axis. Points behind the camera pan to 0.
 * Expects `camera.matrixWorldInverse` to be current (true after any render).
 */
export function screenPan(worldPos: THREE.Vector3, camera: THREE.Camera): number {
  view.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  if (view.z >= 0) return 0;
  view.applyMatrix4(camera.projectionMatrix);
  if (!Number.isFinite(view.x)) return 0;
  return THREE.MathUtils.clamp(view.x * MAX_PAN, -MAX_PAN, MAX_PAN);
}
