import * as THREE from 'three';
import { attachModel } from '../core/models';

/** Leaf and twig geometry inside the existing movement-only bush footprint. */
export class Bush {
  private readonly bushMesh = new THREE.Group();
  constructor(position: THREE.Vector3, private scene: THREE.Object3D, rotation = 0) {
    this.bushMesh.position.copy(position);
    this.bushMesh.rotation.y = rotation;
    attachModel(this.bushMesh, 'noir-shrub');
    scene.add(this.bushMesh);
  }
  public getObject3D(): THREE.Group { return this.bushMesh; }
  public getPosition(): THREE.Vector3 { return this.bushMesh.position.clone(); }
  public remove(): void { this.scene.remove(this.bushMesh); }
}
