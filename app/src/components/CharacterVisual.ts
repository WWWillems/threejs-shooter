import * as THREE from 'three';
import { attachModel } from '../core/models';

/** Keep the controller's mesh/hitbox contract, with a cosmetic Blender child. */
export function addCharacterVisual(player: THREE.Mesh): void {
  attachModel(player, 'noir-character', (model) => {
    for (const material of Array.isArray(player.material) ? player.material : [player.material]) {
      material.visible = false;
    }
    player.castShadow = false;
    const height = player.geometry instanceof THREE.BoxGeometry ? player.geometry.parameters.height : 2;
    model.scale.y = height / 2;
  });
}
export function setCharacterCrouch(player: THREE.Mesh, crouched: boolean): void {
  const visual = player.getObjectByName('noir-character');
  if (visual) visual.scale.y = crouched ? .5 : 1;
}
