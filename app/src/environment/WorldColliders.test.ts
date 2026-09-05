import { describe, expect, it } from "vitest";
import {
  PLAYER_SIZE,
  aabbCenter,
  aabbContains,
  aabbFromCenterSize,
  crateBox,
  generateMap,
  levelFromMap,
  mapFromLevel,
  solidColliders,
} from "@threejs-shooter/shared";
import { WorldColliders } from "./WorldColliders";

const map = generateMap();
/** A spot guaranteed to be open ground: spawn points are validated clear of everything. */
const open = map.spawnPoints[0];
const playerBoxAt = (x: number, z: number) =>
  aabbFromCenterSize({ x, y: 1, z }, PLAYER_SIZE);

describe("WorldColliders", () => {
  it("stops bullets on exactly the geometry the server sweeps against", () => {
    const world = new WorldColliders(map);
    for (const collider of solidColliders(map)) {
      expect(world.stopsBullet(aabbCenter(collider.box))).toBe(true);
    }
    for (const crate of map.crates) {
      expect(world.stopsBullet(crate.position)).toBe(true);
    }
    expect(world.stopsBullet(open)).toBe(false);
  });

  it("lets bullets pass bushes and cones but blocks walking through them", () => {
    const world = new WorldColliders(map);
    // Some cones are parked under the crashed car or against the shop; pick
    // ones standing in the open so the soft/solid distinction is observable.
    const clear = (p: { x: number; z: number }, y: number) =>
      !solidColliders(map).some((c) => aabbContains(c.box, { ...p, y }));
    const bush = map.bushes.find((b) => clear(b.position, 0.5))!.position;
    const cone = map.cones.find((c) => clear(c.position, 0.3))!.position;
    expect(world.stopsBullet({ ...bush, y: 0.5 })).toBe(false);
    expect(world.stopsBullet({ ...cone, y: 0.3 })).toBe(false);
    expect(world.blocksMovement(playerBoxAt(bush.x, bush.z))).toBe(true);
    expect(world.blocksMovement(playerBoxAt(cone.x, cone.z))).toBe(true);
  });

  it("blocks movement into solid geometry and crates, not open ground", () => {
    const world = new WorldColliders(map);
    const car = map.cars[0].position;
    const crate = map.crates[0].position;
    expect(world.blocksMovement(playerBoxAt(car.x, car.z))).toBe(true);
    expect(world.blocksMovement(playerBoxAt(crate.x, crate.z))).toBe(true);
    expect(world.blocksMovement(playerBoxAt(open.x, open.z))).toBe(false);
  });

  it("forgets a crate once the server destroys it", () => {
    const world = new WorldColliders(map);
    // A crate whose centre lies in no other collider, so removal is observable.
    const crate = map.crates.find((c) => {
      const centre = aabbCenter(crateBox(c));
      return !world
        .colliders()
        .some((o) => o.id !== c.id && aabbContains(o.box, centre));
    });
    if (!crate) throw new Error("map has no isolated crate");
    const inside = aabbCenter(crateBox(crate));

    expect(world.stopsBullet(inside)).toBe(true);
    expect(world.hasCrate(crate.id)).toBe(true);
    expect(world.removeCrate(crate.id)).toBe(true);
    expect(world.hasCrate(crate.id)).toBe(false);
    expect(world.removeCrate(crate.id)).toBe(false);
    expect(world.stopsBullet(inside)).toBe(false);
    expect(world.colliders().some((c) => c.id === crate.id)).toBe(false);
  });

  it("lists every collider once, tagged by kind", () => {
    const world = new WorldColliders(map);
    const all = world.colliders();
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    const byKind = (kind: string) => all.filter((c) => c.kind === kind).length;
    expect(byKind("solid")).toBe(solidColliders(map).length);
    expect(byKind("crate")).toBe(map.crates.length);
    expect(byKind("movement-only")).toBe(map.bushes.length + map.cones.length + map.props.filter((prop) => ["trash-bag", "fence", "fence-gate"].includes(prop.type)).length);
  });

  it("builds identical colliders from an authored level document", () => {
    const authoredMap = mapFromLevel(levelFromMap(map));
    const authoredWorld = new WorldColliders(authoredMap);

    expect(authoredWorld.colliders()).toEqual(new WorldColliders(map).colliders());
  });
});
