import * as THREE from 'three';
import { attachModel } from '../core/models';
import { CharacterAnimator, type CharacterMotion } from './CharacterAnimator';

interface VisualState {
  animator?: CharacterAnimator;
  previous: THREE.Vector3;
  crouched: boolean;
  dead: boolean;
  initialized: boolean;
  speed: number;
  removed: boolean;
}
const visuals = new WeakMap<THREE.Object3D, VisualState>();
export function addCharacterVisual(player: THREE.Mesh): void {
  const state: VisualState = { previous: player.position.clone(), crouched: false,
    dead: false, initialized: false, speed: 0, removed: false };
  visuals.set(player, state);
  attachModel(player, 'noir-character', (model) => {
    if (state.removed) { player.remove(model); return; }
    for (const material of Array.isArray(player.material) ? player.material : [player.material]) material.visible = false;
    player.castShadow = false;
    model.position.y = -1;
    state.animator = new CharacterAnimator(model, model.animations);
  });
}
export function setCharacterCrouch(player: THREE.Object3D, crouched: boolean): void {
  const state = visuals.get(player);
  if (state) state.crouched = crouched;
}
export function setCharacterDead(player: THREE.Object3D, dead: boolean): void {
  const state = visuals.get(player);
  if (!state) return;
  if (state.dead && !dead) {
    state.animator?.reset(); state.initialized = false; state.crouched = false;
  }
  state.dead = dead;
}
export function pulseCharacterShot(player: THREE.Object3D, strength: number): void {
  visuals.get(player)?.animator?.shoot(strength);
}
export function characterSocket(player: THREE.Object3D): THREE.Object3D | undefined {
  return visuals.get(player)?.animator?.socket ?? player.getObjectByName('WeaponSocket');
}
export function updateCharacterVisual(player: THREE.Object3D, dt: number,
  pose?: { crouched: boolean; grounded: boolean; reload: number }): void {
  const state = visuals.get(player);
  if (!state) return;
  if (pose) state.crouched = pose.crouched;
  const delta = Math.max(dt, .001);
  const velocity = player.position.clone().sub(state.previous).divideScalar(delta);
  if (!state.initialized || velocity.length() > 45) velocity.set(0, 0, 0);
  state.previous.copy(player.position); state.initialized = true;
  const speed = Math.hypot(velocity.x, velocity.z);
  state.speed = THREE.MathUtils.damp(state.speed, speed, 18, Math.min(dt, .05));
  const c = Math.cos(player.rotation.y), s = Math.sin(player.rotation.y);
  const motion: CharacterMotion = {
    speed: state.speed, forward: velocity.x * -s + velocity.z * -c,
    strafe: velocity.x * c - velocity.z * s, verticalSpeed: velocity.y,
    grounded: pose?.grounded ?? player.position.y <= (state.crouched ? .53 : 1.03),
    crouched: state.crouched, dead: state.dead, reload: pose?.reload ?? 0,
  };
  if (state.animator) {
    state.animator.model.position.y = state.crouched ? -.5 : -1;
    state.animator.update(dt, motion);
  }
}
export function removeCharacterVisual(player: THREE.Object3D): void {
  const state = visuals.get(player);
  if (state) { state.removed = true; state.animator?.dispose(); }
  visuals.delete(player);
}
