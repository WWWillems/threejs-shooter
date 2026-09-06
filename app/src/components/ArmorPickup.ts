import * as THREE from 'three';
import { Pickup } from './Pickup';
import { attachModel } from '../core/models';

/** Cosmetic vest; collection and absorption are authoritative on the server. */
export class ArmorPickup extends Pickup {
  protected createMesh(): THREE.Object3D {
    const root = new THREE.Group();
    const visual = new THREE.Group();
    root.add(visual);
    attachModel(visual, 'noir-armor-pickup');
    let age = Math.random() * Math.PI * 2;
    window.__pickupAnimations ??= [];
    window.__pickupAnimations.push(dt => {
      if (!root.parent) return false;
      age += dt;
      visual.position.y = Math.sin(age * 2) * .12;
      visual.rotation.y += dt * .6;
      return true;
    });
    return root;
  }
  protected getPickupType(): string { return 'armor'; }
  protected collectionEffectColor(): number { return 0x59bbd4; }
}
