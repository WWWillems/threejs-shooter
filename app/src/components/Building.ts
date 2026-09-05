import * as THREE from "three";
import type { BuildingType } from "@threejs-shooter/shared";
import { attachModel } from "../core/models";

/** Exterior-only building shell; gameplay solidity is owned by shared level data. */
export class Building {
  private readonly mesh = new THREE.Group();

  constructor(
    type: BuildingType,
    position: THREE.Vector3,
    private readonly scene: THREE.Object3D
  ) {
    this.mesh.name = type;
    this.mesh.position.copy(position);
    attachModel(this.mesh, `noir-${type}`);
    scene.add(this.mesh);
  }

  public getObject3D(): THREE.Group {
    return this.mesh;
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
  }
}
