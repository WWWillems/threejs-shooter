import * as THREE from 'three';
import { attachModel } from '../core/models';

/** Branch and needle geometry; only the shared trunk blocks gameplay. */
export class Tree {
  private readonly treeMesh = new THREE.Group();
  constructor(position: THREE.Vector3, private scene: THREE.Object3D, rotation = 0, scale = 1) {
    this.treeMesh.position.copy(position);
    this.treeMesh.rotation.y = rotation;
    this.treeMesh.scale.setScalar(scale);
    attachModel(this.treeMesh, 'noir-pine');
    scene.add(this.treeMesh);
  }
  public getObject3D(): THREE.Group { return this.treeMesh; }
  public getPosition(): THREE.Vector3 { return this.treeMesh.position.clone(); }
  public remove(): void { this.scene.remove(this.treeMesh); }
}
