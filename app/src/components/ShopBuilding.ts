import * as THREE from 'three';
import { attachModel } from '../core/models';
import { LAMP_COLOR } from '../core/Scene';

/** Detailed shell at the original shop footprint; the shared collider owns solidity. */
export class ShopBuilding {
  private readonly shopMesh = new THREE.Group();
  constructor(position: THREE.Vector3, private scene: THREE.Object3D) {
    this.shopMesh.position.copy(position);
    attachModel(this.shopMesh, 'noir-shop');
    const entrance = new THREE.SpotLight(LAMP_COLOR, 110, 13, Math.PI / 2.8, .9, 2);
    entrance.position.set(0, 3.87, 4.52);
    entrance.target.position.set(0, .5, 4.05);
    entrance.castShadow = true;
    entrance.shadow.mapSize.set(512, 512);
    entrance.shadow.bias = -.0002;
    entrance.shadow.normalBias = .025;
    this.shopMesh.add(entrance, entrance.target);
    scene.add(this.shopMesh);
  }
  public getObject3D(): THREE.Group {
    return this.shopMesh;
  }
  public dispose(): void {
    this.scene.remove(this.shopMesh);
    this.shopMesh.traverse((object) => {
      if (object instanceof THREE.SpotLight) object.dispose();
    });
  }
}
