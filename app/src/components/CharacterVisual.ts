import * as THREE from 'three';
import type { Team } from '@threejs-shooter/shared';
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
  team: Team;
  generation: number;
}
const visuals = new WeakMap<THREE.Object3D, VisualState>();
const CHARACTER_MODEL_BY_TEAM: Record<Team, string> = {
  blue: 'noir-character-team-a',
  red: 'noir-character-team-b',
};

export function characterModelForTeam(team: Team): string {
  return CHARACTER_MODEL_BY_TEAM[team];
}

export function addCharacterVisual(player: THREE.Mesh): void {
  const state: VisualState = { previous: player.position.clone(), crouched: false,
    dead: false, initialized: false, speed: 0, removed: false, team:'blue', generation:0 };
  visuals.set(player,state);loadTeamModel(player,state);
}
function loadTeamModel(player:THREE.Mesh,state:VisualState):void {
  const generation=++state.generation;
  attachModel(player,characterModelForTeam(state.team),model=>{
    if(state.removed||state.generation!==generation){player.remove(model);return;}
    const previous=state.animator;
    previous?.dispose();if(previous)player.remove(previous.model);
    for(const material of Array.isArray(player.material)?player.material:[player.material])material.visible=false;
    player.castShadow=false;
    model.traverse(o=>{if(/^WeaponSocket[._]?\d+$/.test(o.name))o.name='WeaponSocket';});
    model.position.y=state.crouched?-.5:-1;
    state.animator=new CharacterAnimator(model,model.animations);
    state.initialized=false;
  });
}
export function setCharacterTeam(player:THREE.Mesh,team:Team):void {
  const state=visuals.get(player);if(!state||state.team===team)return;
  state.team=team;loadTeamModel(player,state);
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
