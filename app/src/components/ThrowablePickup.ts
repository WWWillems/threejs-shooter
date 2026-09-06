import * as THREE from "three";
import { GRENADE, type GrenadeKind } from "@threejs-shooter/shared";
import { Pickup } from "./Pickup";
import { GRENADE_COLORS } from "./grenadeIcons";
import { grenadeGeometry, grenadeMaterial } from "./grenadeMeshes";

/** Grenades are small; loot is drawn bigger so it reads from the isometric camera. */
const LOOT_SCALE = 1.6;

/**
 * Server-owned throwable loot: a pair of one grenade kind leaning together on
 * a ring in the kind's casing colour, so it reads at a glance next to weapon
 * and ammo drops. The count travels in the spec; the mesh only shows the kind.
 */
export class ThrowablePickup extends Pickup {
  constructor(scene: THREE.Scene, position: THREE.Vector3, kind: GrenadeKind, amount: number) {
    super(scene, position, { grenadeKind: kind, amount });
  }

  protected createMesh(): THREE.Object3D {
    const kind = this.pickupData.grenadeKind as GrenadeKind;
    const root = new THREE.Group();
    const bundle = new THREE.Group();
    root.add(bundle);

    const geometry = grenadeGeometry(kind);
    const material = grenadeMaterial(kind);
    const restHeight = GRENADE.radius * LOOT_SCALE * (kind === "frag" ? 1 : 1.4);
    for (const [x, tilt] of [
      [-0.12, 0.25],
      [0.12, -0.25],
    ] as const) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.setScalar(LOOT_SCALE);
      mesh.position.set(x, restHeight, 0);
      mesh.rotation.z = tilt;
      mesh.castShadow = true;
      bundle.add(mesh);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.025, 6, 32),
      new THREE.MeshBasicMaterial({ color: GRENADE_COLORS[kind] })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.35;
    root.add(ring);

    let age = 0;
    window.__pickupAnimations ??= [];
    window.__pickupAnimations.push((dt) => {
      if (!root.parent) return false;
      age += dt;
      bundle.position.y = Math.sin(age * 2) * 0.1;
      bundle.rotation.y += dt * 0.8;
      return true;
    });
    return root;
  }

  protected getPickupType(): string {
    return `throwable_${this.pickupData.grenadeKind}`;
  }

  protected collectionEffectColor(): number {
    return GRENADE_COLORS[this.pickupData.grenadeKind as GrenadeKind];
  }
}
