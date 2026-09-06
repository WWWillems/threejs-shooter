import * as THREE from 'three';
const point = () => new THREE.Vector3();

/** Two-bone support-arm IK: the off-hand follows the actual weapon through aim and reload. */
export function alignSupportHand(player: THREE.Object3D, weapon: THREE.Object3D, pistol: boolean, reload: number): void {
  const upper = player.getObjectByName('UpperArmL');
  const forearm = player.getObjectByName('ForearmL');
  const hand = player.getObjectByName('HandL');
  if (!upper || !forearm || !hand) return;
  // During reload the authored reach takes over; blend back onto the fore-end afterwards.
  const weight = 1 - Math.sin(Math.min(1, reload) * Math.PI);
  player.updateMatrixWorld(true); weapon.updateMatrixWorld(true);
  const shoulder = upper.getWorldPosition(point());
  const elbow = forearm.getWorldPosition(point());
  const wrist = hand.getWorldPosition(point());
  const target = weapon.localToWorld(new THREE.Vector3(0, pistol ? -.075 : -.065, pistol ? .012 : -.33));
  target.lerp(wrist, 1 - weight);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(wrist);
  const toward = target.clone().sub(shoulder);
  const distance = THREE.MathUtils.clamp(toward.length(), Math.abs(a - b) + .001, a + b - .001);
  toward.normalize();
  const hint = new THREE.Vector3(-1, -.55, .2).applyQuaternion(player.quaternion);
  const bend = hint.addScaledVector(toward, -hint.dot(toward)).normalize();
  const along = (a * a + distance * distance - b * b) / (2 * distance);
  const desiredElbow = shoulder.clone().addScaledVector(toward, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
  const rotate = (joint: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
    const correction = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const world = joint.getWorldQuaternion(new THREE.Quaternion());
    const parent = joint.parent!.getWorldQuaternion(new THREE.Quaternion());
    joint.quaternion.copy(parent.invert().multiply(correction).multiply(world));
    joint.updateMatrixWorld(true);
  };
  rotate(upper, elbow.clone().sub(shoulder), desiredElbow.sub(shoulder));
  const movedElbow = forearm.getWorldPosition(point());
  const movedWrist = hand.getWorldPosition(point());
  rotate(forearm, movedWrist.sub(movedElbow), target.sub(movedElbow));
}
