import * as THREE from 'three';
import type { PropType } from '@threejs-shooter/shared';
import { attachModel } from '../core/models';

/** Static yard dressing; the shared prop definitions own gameplay collision. */
export function addYardProp(scene: THREE.Scene, type: PropType, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(position);
  group.name = type;
  if(type === 'fence-gate') {
    const frame=new THREE.Group();frame.name='GateFrame';group.add(frame);attachModel(frame,'noir-lift-gate-frame');
    const panel=new THREE.Group();panel.name='MovingGate';group.add(panel);attachModel(panel,'noir-lift-gate-panel');
  } else attachModel(group, `noir-${type}`);
  scene.add(group);
  return group;
}
