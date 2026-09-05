import { GAME_EVENTS, type MapLayout } from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import type { CollisionSystem } from "./CollisionSystem";

/**
 * Keeps the client's crates in step with the server. Crates are built from the
 * shared map layout at startup; the server then tells us which ones took
 * damage or are gone. On (re)join, GAME.STATE lists the survivors so crates
 * destroyed before we arrived are removed without an effect.
 */
export class CrateSync {
  constructor(
    private readonly net: NetworkClient,
    private readonly collisionSystem: CollisionSystem,
    private readonly map: MapLayout
  ) {
    this.setupNetworkListeners();
  }

  private setupNetworkListeners(): void {
    const { net, collisionSystem } = this;

    net.on(GAME_EVENTS.GAME.STATE, ({ crates }) => {
      const alive = new Map(crates.map((c) => [c.id, c.hp]));
      for (const spec of this.map.crates) {
        const hp = alive.get(spec.id);
        if (hp === undefined) {
          collisionSystem.destroyWoodenCrate(spec.id, false);
        } else {
          collisionSystem.getWoodenCrate(spec.id)?.applyServerHp?.(hp);
        }
      }
    });

    net.on(GAME_EVENTS.CRATE.DAMAGED, ({ crateId, hp }) => {
      collisionSystem.getWoodenCrate(crateId)?.applyServerHp?.(hp);
    });

    net.on(GAME_EVENTS.CRATE.DESTROYED, ({ crateId }) => {
      collisionSystem.destroyWoodenCrate(crateId);
    });
  }
}
