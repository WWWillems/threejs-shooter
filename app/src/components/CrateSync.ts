import { GAME_EVENTS, type MapLayout } from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import type { WorldColliders } from "../environment/WorldColliders";
import type { DestructibleCrate } from "./WoodenCrate";

/** Where crate meshes live, keyed by shared crate id. */
export interface CrateMeshes {
  getCrate(crateId: string): DestructibleCrate | undefined;
}

/**
 * Keeps the client's crates in step with the server. Crates are built from the
 * shared map layout at startup, both as meshes and as world colliders; the
 * server then tells us which ones took damage or are gone. On (re)join,
 * GAME.STATE lists the survivors so crates destroyed before we arrived are
 * removed without an effect.
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
          this.meshes.getCrate(spec.id)?.applyServerHp?.(hp);
        }
      }
    });

    this.net.on(GAME_EVENTS.CRATE.DAMAGED, ({ crateId, hp }) => {
      this.meshes.getCrate(crateId)?.applyServerHp?.(hp);
    });

    this.net.on(GAME_EVENTS.CRATE.DESTROYED, ({ crateId }) => {
      this.destroy(crateId, true);
    });
  }

  /** The server says this crate is gone: stop colliding with it, drop the mesh. */
  private destroy(crateId: string, withEffect: boolean): void {
    this.world.removeCrate(crateId);
    this.meshes.getCrate(crateId)?.destroy?.(withEffect);
  }
}
