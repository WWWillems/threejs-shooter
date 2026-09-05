import * as THREE from "three";
import type { AABB } from "@threejs-shooter/shared";
import type {
  WorldColliderKind,
  WorldColliders,
} from "../environment/WorldColliders";
import { PlayerCollider } from "./PlayerCollider";

const COLOURS = {
  localPlayer: 0x00ff00,
  remotePlayer: 0xff0000,
  solid: 0xff4444,
  crate: 0xffa500,
  movementOnly: 0xffff00,
} as const;

const colourFor = (kind: WorldColliderKind): number => {
  switch (kind) {
    case "solid":
      return COLOURS.solid;
    case "crate":
      return COLOURS.crate;
    case "movement-only":
      return COLOURS.movementOnly;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

/**
 * Debug overlay (toggle with B). Draws exactly what the game collides with:
 * every world collider as held by `WorldColliders`, and every player hitbox
 * as `PlayerCollider` tests it, so what you see is what bullets hit.
 */
export class DebugVisualizer {
  private debugHelpers: THREE.Object3D[] = [];
  private debugMode = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldColliders,
    private readonly player: THREE.Object3D,
    private readonly remotePlayerMeshes: () => Iterable<THREE.Object3D>
  ) {}

  public toggleDebugMode(): void {
    this.debugMode = !this.debugMode;
    if (!this.debugMode) {
      this.clearDebugHelpers();
    }
  }

  public isDebugMode(): boolean {
    return this.debugMode;
  }

  /** Rebuild the overlay for this frame. */
  public updateDebugVisualization(): void {
    this.clearDebugHelpers();
    if (!this.debugMode) return;

    for (const collider of this.world.colliders()) {
      this.add(wireframeBox(collider.box, colourFor(collider.kind)));
    }

    this.add(PlayerCollider.createDebugMesh(this.player, COLOURS.localPlayer));
    for (const mesh of this.remotePlayerMeshes()) {
      this.add(PlayerCollider.createDebugMesh(mesh, COLOURS.remotePlayer));
    }
  }

  private add(helper: THREE.Object3D): void {
    this.scene.add(helper);
    this.debugHelpers.push(helper);
  }

  private clearDebugHelpers(): void {
    for (const helper of this.debugHelpers) {
      this.scene.remove(helper);
      if (helper instanceof THREE.Mesh || helper instanceof THREE.Line) {
        helper.geometry?.dispose();
        const materials = Array.isArray(helper.material)
          ? helper.material
          : [helper.material];
        for (const material of materials) material?.dispose();
      }
    }
    this.debugHelpers = [];
  }
}

function wireframeBox(box: AABB, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      box.max.x - box.min.x,
      box.max.y - box.min.y,
      box.max.z - box.min.z
    ),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    })
  );
  mesh.position.set(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2
  );
  return mesh;
}
