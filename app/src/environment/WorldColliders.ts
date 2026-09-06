import {
  aabbContains, initialInteractions, interactionBoxes,
  type PropSpec, type InteractionState,
  aabbIntersects,
  crateBox,
  movementOnlyColliders,
  solidColliders,
  type AABB,
  type CrateSpec,
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
  private readonly props: Map<string, PropSpec>;
  private dynamic: WorldCollider[] = [];
  private readonly solid: WorldCollider[];
  private readonly movementOnly: WorldCollider[];
  private readonly crates = new Map<string, WorldCollider>();

  constructor(map: MapLayout) {
    this.props = new Map(map.props.map(p=>[p.id,p]));
    this.syncInteractions(initialInteractions(map.props));
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
    for (const c of this.dynamic) if (aabbIntersects(box,c.box)) return true;
    for (const c of this.solid) if (aabbIntersects(box, c.box)) return true;
    for (const c of this.crates.values())
      if (aabbIntersects(box, c.box)) return true;
    for (const c of this.movementOnly)
      if (aabbIntersects(box, c.box)) return true;
    return false;
  }

  /** Does a cosmetic bullet at `point` sit inside solid geometry or a crate? */
  stopsBullet(point: Vec3): boolean {
    for (const c of this.dynamic) if (c.kind !== "movement-only" && aabbContains(c.box,point)) return true;
    for (const c of this.solid) if (aabbContains(c.box, point)) return true;
    for (const c of this.crates.values())
      if (aabbContains(c.box, point)) return true;
    return false;
  }

  syncInteractions(states: InteractionState[]): void {
    this.dynamic = states.flatMap(s=>{const p=this.props.get(s.id);return p ? interactionBoxes(p,s).map((box,index)=>({id:`${s.id}:${index}`,kind:p.type==='fence-gate'?'movement-only' as const:'solid' as const,box})):[];});
  }

  hasCrate(crateId: string): boolean {
    return this.crates.has(crateId);
  }

  /** The server said this crate is gone; stop colliding with it. */
  removeCrate(crateId: string): boolean {
    return this.crates.delete(crateId);
  }

  /** The server rebuilt this crate (round reset); collide with it again. */
  restoreCrate(spec: CrateSpec): void {
    this.crates.set(spec.id, { id: spec.id, kind: "crate", box: crateBox(spec) });
  }

  /** Everything currently collidable, for the debug overlay. */
  colliders(): WorldCollider[] {
    return [...this.dynamic, ...this.solid, ...this.crates.values(), ...this.movementOnly];
  }
}
