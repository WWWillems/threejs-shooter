import * as THREE from 'three';

export interface CharacterMotion {
  speed: number;
  forward: number;
  strafe: number;
  verticalSpeed: number;
  grounded: boolean;
  crouched: boolean;
  dead: boolean;
  reload: number;
}

/** Per-instance skeleton/mixer; animation never moves the gameplay hitbox. */
export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer;
  readonly socket: THREE.Object3D | undefined;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private landedFor = 0;
  private wasGrounded = true;
  private recoil = 0;
  private spine?: THREE.Object3D;
  private leftArm?: THREE.Object3D;
  private hips?: THREE.Object3D;
  state = 'Idle';

  constructor(readonly model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      if (['Death', 'Land'].includes(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    this.socket = model.getObjectByName('WeaponSocket');
    this.spine = model.getObjectByName('Spine');
    this.leftArm = model.getObjectByName('UpperArmL');
    this.hips = model.getObjectByName('Hips');
  }

  shoot(strength = 1): void { this.recoil = Math.min(.22, this.recoil + strength * .1); }
  reset(): void {
    this.mixer.stopAllAction();
    this.current = undefined;
    this.recoil = this.landedFor = 0;
    this.wasGrounded = true;
  }
  update(dt: number, motion: CharacterMotion): void {
    dt = Math.min(Math.max(dt, 0), .05);
    if (motion.grounded && !this.wasGrounded) this.landedFor = .18;
    this.wasGrounded = motion.grounded;
    this.landedFor = Math.max(0, this.landedFor - dt);
    const next = motion.dead ? 'Death'
      : !motion.grounded ? (motion.verticalSpeed > .15 ? 'Jump' : 'Fall')
      : this.landedFor > 0 && !motion.crouched ? 'Land'
      : motion.crouched ? (motion.speed > .25 ? 'CrouchWalk' : 'CrouchIdle')
      : motion.speed > 13 ? 'Run' : motion.speed > .25 ? 'Walk' : 'Idle';
    const action = this.actions.get(next);
    if (action && action !== this.current) {
      action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      if (this.current) action.crossFadeFrom(this.current, next === 'Death' ? .1 : .14, false);
      this.current = action;
    }
    this.state = next;
    if (this.current && ['Walk', 'Run', 'CrouchWalk'].includes(next)) {
      const pace = next === 'Run' ? 20 : next === 'CrouchWalk' ? 5 : 10;
      this.current.timeScale = THREE.MathUtils.clamp(motion.speed / pace, .5, 1.7) * (motion.forward < -.2 ? -1 : 1);
    }
    this.mixer.update(dt);
    this.recoil *= Math.exp(-dt * 19);
    if (!motion.dead) {
      this.spine?.rotateX(this.recoil);
      // The support hand reaches down and returns during reload; the right hand holds the gun.
      const reloadReach = motion.reload > 0 ? Math.sin(motion.reload * Math.PI) : 0;
      this.leftArm?.rotateX(reloadReach * -.8);
      this.hips?.rotateY(THREE.MathUtils.clamp(motion.strafe * .018, -.22, .22));
    }
    this.model.updateMatrixWorld(true);
  }
  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
}
