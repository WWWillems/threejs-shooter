import * as THREE from "three";
import { GAME_EVENTS, type CrateSpec, type MapLayout, type Vec3 } from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import type { WorldColliders } from "../environment/WorldColliders";
import type { DestructibleCrate } from "./WoodenCrate";
import { sfx } from "../audio/sfx";

/** Where crate meshes live, keyed by shared crate id. */
export interface CrateMeshes {
  getCrate(crateId: string): DestructibleCrate | undefined;
}

/**
 * Keeps the client's crates in step with the server. Crates are built from the
 * shared map layout at startup, both as meshes and as world colliders; the
 * server then tells us which ones took damage or are gone. GAME.STATE (on
 * join and on every round reset) lists the survivors: crates it omits are
 * removed without an effect, crates it lists that we had destroyed come back.
 */
export class CrateSync {
  constructor(
    private readonly net: NetworkClient,
    private readonly world: WorldColliders,
    private readonly meshes: CrateMeshes,
    private readonly map: MapLayout
  ) {
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    this.net.on(GAME_EVENTS.GAME.STATE, ({ crates }) => {
      const alive = new Map(crates.map((c) => [c.id, c.hp]));
      for (const spec of this.map.crates) {
        const hp = alive.get(spec.id);
        if (hp === undefined) {
          this.destroy(spec.id, false);
        } else {
          if (!this.world.hasCrate(spec.id)) this.restore(spec);
          this.meshes.getCrate(spec.id)?.applyServerHp?.(hp);
        }
      }
    });

    this.net.on(GAME_EVENTS.CRATE.DAMAGED, ({ crateId, hp }) => {
      const position = this.getCratePosition(crateId);
      if (position) sfx.play("crate:hit", position);
      this.meshes.getCrate(crateId)?.applyServerHp?.(hp);
    });

    this.net.on(GAME_EVENTS.CRATE.DESTROYED, ({ crateId, position: eventPosition }) => {
      const position = this.getCratePosition(crateId, eventPosition);
      if (position) sfx.play("crate:break", position);
      this.destroy(crateId, true);
    });
  }

  private getCratePosition(
    crateId: string,
    eventPosition?: Vec3
  ): THREE.Vector3 | undefined {
    const mesh = this.meshes.getCrate(crateId);
    if (mesh) return mesh.position.clone();

    if (eventPosition) {
      return new THREE.Vector3(
        eventPosition.x,
        eventPosition.y,
        eventPosition.z
      );
    }

    const spec = this.map.crates.find((crate) => crate.id === crateId);
    return spec
      ? new THREE.Vector3(spec.position.x, spec.position.y, spec.position.z)
      : undefined;
  }

  /** The server says this crate is gone: stop colliding with it, drop the mesh. */
  private destroy(crateId: string, withEffect: boolean): void {
    this.world.removeCrate(crateId);
    this.meshes.getCrate(crateId)?.destroy?.(withEffect);
  }

  /** The server rebuilt this crate for a new round: collide with it and show it again. */
  private restore(spec: CrateSpec): void {
    this.world.restoreCrate(spec);
    this.meshes.getCrate(spec.id)?.restore?.();
  }
}
