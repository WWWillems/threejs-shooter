import {
  aabbContains,
  aabbIntersects,
  crateBox,
  movementOnlyColliders,
  solidColliders,
  type AABB,
  type MapLayout,
  type Vec3,
} from "@threejs-shooter/shared";

export type WorldColliderKind = "solid" | "crate" | "movement-only";

export interface WorldCollider {
  id: string;
  kind: WorldColliderKind;
  box: AABB;
}

/**
 * The client's mirror of the server's collision world, built from the shared
 * `MapLayout` and never from meshes.
 *
 * - solid: walls, shop, cars, street lights, tree trunks (`solidColliders`),
 *   the exact boxes the server sweeps bullets and grenades against.
 * - crate: live crates; removed as the server reports them destroyed.
 * - movement-only: bushes and cones; block the Local player, let bullets pass.
 *
 * Players are not in here: they come from the Local player and Replication
 * and are composed in by whoever asks "does a bullet stop here?".
 */
export class WorldColliders {
  private readonly solid: WorldCollider[];
  private readonly movementOnly: WorldCollider[];
  private readonly crates = new Map<string, WorldCollider>();

  constructor(map: MapLayout) {
    this.solid = solidColliders(map).map((c) => ({
      id: c.tag.id,
      kind: "solid",
      box: c.box,
    }));
    this.movementOnly = movementOnlyColliders(map).map((c) => ({
      id: c.id,
      kind: "movement-only",
      box: c.box,
    }));
    for (const spec of map.crates) {
      this.crates.set(spec.id, {
        id: spec.id,
        kind: "crate",
        box: crateBox(spec),
      });
    }
  }

  /** Would a player occupying `box` overlap anything that blocks movement? */
  blocksMovement(box: AABB): boolean {
    for (const c of this.solid) if (aabbIntersects(box, c.box)) return true;
    for (const c of this.crates.values())
      if (aabbIntersects(box, c.box)) return true;
    for (const c of this.movementOnly)
      if (aabbIntersects(box, c.box)) return true;
    return false;
  }

  /** Does a cosmetic bullet at `point` sit inside solid geometry or a crate? */
  stopsBullet(point: Vec3): boolean {
    for (const c of this.solid) if (aabbContains(c.box, point)) return true;
    for (const c of this.crates.values())
      if (aabbContains(c.box, point)) return true;
    return false;
  }

  hasCrate(crateId: string): boolean {
    return this.crates.has(crateId);
  }

  /** The server said this crate is gone; stop colliding with it. */
  removeCrate(crateId: string): boolean {
    return this.crates.delete(crateId);
  }

  /** Everything currently collidable, for the debug overlay. */
  colliders(): WorldCollider[] {
    return [...this.solid, ...this.crates.values(), ...this.movementOnly];
  }
}
