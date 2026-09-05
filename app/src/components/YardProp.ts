import * as THREE from 'three';
import type { PropType } from '@threejs-shooter/shared';
import { attachModel } from '../core/models';

/** Static yard dressing; the shared prop definitions own gameplay collision. */
export function addYardProp(scene: THREE.Scene, type: PropType, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);
  group.name = type;
  attachModel(group, `noir-${type}`);
  scene.add(group);
  return group;
}
