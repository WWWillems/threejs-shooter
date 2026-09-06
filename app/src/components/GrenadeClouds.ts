import * as THREE from "three";
import {
  CLOUD_EFFECTS,
  cloudObscures,
  type CloudKind,
  type CloudSnapshot,
} from "@threejs-shooter/shared";
import type { Replication } from "../net/Replication";
import { FIRE_TINT, GAS_TINT, SMOKE_TINT, createSmokeMaterial, type SmokeMaterial } from "./smokeShader";

interface CloudEffect {
  kind: CloudKind;
  root: THREE.Group;
  puffs: THREE.Mesh<THREE.PlaneGeometry, SmokeMaterial>[];
  /** Glowing ground disc; only fire has one. */
  glow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null;
  /** Newest server state, for the concealment test and the fade-out. */
  state: CloudSnapshot;
  /** Seconds since the cloud first appeared, for the fade-in. */
  age: number;
}

/** How each cloud kind is drawn. */
interface CloudLook {
  tint: { a: THREE.Color; b: THREE.Color };
  blending: THREE.Blending;
  /** Opacity once fully faded in. */
  peak: number;
  /** Horizontal spread of the puffs, as a fraction of the cloud radius, at fade-in start and end. */
  spread: [number, number];
  /** How high the puffs drift above the ground. */
  lift: number;
  /** How fast the puffs churn. */
  churn: number;
  /** Colour of the ground glow, or null for none. */
  glow: number | null;
}

const LOOKS: Record<CloudKind, CloudLook> = {
  // Smoke billows outwards after the pop; a wall you cannot see through.
  smoke: { tint: SMOKE_TINT, blending: THREE.NormalBlending, peak: 0.85, spread: [0.45, 0.7], lift: 1.9, churn: 0.1, glow: null },
  // Gas settles low and wide; a haze.
  gas: { tint: GAS_TINT, blending: THREE.NormalBlending, peak: 0.55, spread: [0.6, 0.6], lift: 1.1, churn: 0.1, glow: null },
  // Fire hugs the ground, flickers fast and lights it from below.
  fire: { tint: FIRE_TINT, blending: THREE.AdditiveBlending, peak: 0.9, spread: [0.5, 0.7], lift: 0.9, churn: 0.45, glow: 0xff6a20 },
};

const PUFFS_PER_CLOUD = 12;
/** Seconds to fade in after the grenade pops, and to thin out before it is gone. */
const FADE_IN = 0.6;
const FADE_OUT = 1.5;

/**
 * Presentation only: draws the smoke, gas and fire clouds the server keeps in
 * its snapshots. Clouds do not move, so the newest snapshot is read as-is
 * rather than interpolated. Also answers whether a smoke cloud sits between the
 * camera and a point, so nameplates behind it can be hidden.
 */
export class GrenadeClouds {
  private readonly effects = new Map<string, CloudEffect>();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly replication: Replication,
    private readonly camera: THREE.Camera
  ) {}

  /** True when smoke hides `position` from the camera. */
  obscures(position: THREE.Vector3): boolean {
    for (const effect of this.effects.values()) {
      if (cloudObscures(this.camera.position, position, effect.state)) return true;
    }
    return false;
  }

  update(dt: number): void {
    this.time += dt;
    (window as unknown as { __cloudsDebug: unknown }).__cloudsDebug = { effects: this.effects, camera: this.camera, latest: this.replication.latest };
    this.sync(this.replication.latest?.clouds ?? []);

    for (const effect of this.effects.values()) {
      effect.age += dt;
      const { radius } = CLOUD_EFFECTS[effect.kind];
      const look = LOOKS[effect.kind];
      const fadeIn = Math.min(1, effect.age / FADE_IN);
      const fadeOut = Math.min(1, effect.state.remaining / FADE_OUT);
      const opacity = look.peak * fadeIn * fadeOut;
      const spread = radius * (look.spread[0] + (look.spread[1] - look.spread[0]) * fadeIn);

      effect.puffs.forEach((puff, i) => {
        const phase = (this.time * look.churn + i * 0.137) % 1;
        const angle = i * 2.399 + this.time * 0.04;
        const ring = 0.4 + 0.6 * ((i * 0.618) % 1);
        puff.position.set(
          Math.cos(angle) * spread * ring,
          0.7 + phase * look.lift,
          Math.sin(angle) * spread * ring
        );
        puff.scale.setScalar(radius * (0.9 + 0.35 * phase) * (0.6 + 0.4 * fadeIn));
        puff.quaternion.copy(this.camera.quaternion);
        puff.material.uniforms.time.value = this.time + i;
        puff.material.uniforms.opacity.value = opacity * (0.8 + 0.2 * Math.sin(phase * Math.PI));
      });

      if (effect.glow) {
        const flicker = 0.85 + 0.15 * Math.sin(this.time * 17 + effect.age * 3);
        effect.glow.material.opacity = 0.55 * fadeIn * fadeOut * flicker;
        effect.glow.scale.setScalar(radius * (0.7 + 0.3 * fadeIn));
      }
    }
  }

  /** Create effects for new clouds, adopt the newest state of known ones, drop the gone. */
  private sync(clouds: CloudSnapshot[]): void {
    const present = new Set<string>();
    for (const state of clouds) {
      present.add(state.id);
      const known = this.effects.get(state.id);
      if (known) {
        known.state = state;
        continue;
      }
      this.effects.set(state.id, this.createEffect(state));
    }
    for (const [id, effect] of this.effects) {
      if (present.has(id)) continue;
      this.scene.remove(effect.root);
      for (const puff of effect.puffs) puff.material.dispose();
      if (effect.glow) {
        effect.glow.geometry.dispose();
        effect.glow.material.dispose();
      }
      this.effects.delete(id);
    }
  }

  private createEffect(state: CloudSnapshot): CloudEffect {
    const root = new THREE.Group();
    root.position.set(state.position.x, state.position.y, state.position.z);
    const look = LOOKS[state.kind];
    const puffs: CloudEffect["puffs"] = [];
    for (let i = 0; i < PUFFS_PER_CLOUD; i++) {
      const puff = new THREE.Mesh(this.geometry, createSmokeMaterial(look.tint, look.blending));
      root.add(puff);
      puffs.push(puff);
    }

    let glow: CloudEffect["glow"] = null;
    if (look.glow !== null) {
      glow = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        new THREE.MeshBasicMaterial({
          color: look.glow,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.03;
      root.add(glow);
    }

    this.scene.add(root);
    return { kind: state.kind, root, puffs, glow, state, age: 0 };
  }
}
