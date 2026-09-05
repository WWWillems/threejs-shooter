import { describe, expect, it } from "vitest";
import {
  aabbFromCenterSize,
  aabbFromRotatedBox,
  aabbIntersects,
  rotatedAabbContains,
  sweepSegmentAABB,
  sweepSegmentRotatedAABB,
} from "./aabb";
import { playerCollider, playerHitbox, playerHitboxContains } from "./playerHitbox";
import { GRENADE, blastDamage, integrateGrenade, spawnGrenade } from "./grenade";
import {
  TREE_TRUNK_SIZE,
  crateBox,
  generateMap,
  movementOnlyColliders,
  solidColliders,
} from "./mapLayout";
import { integrateProjectile, spawnPellets, type Collider } from "./projectile";
import {
  PICKUP_REACH,
  findPickupSpawnPosition,
  isWithinPickupReach,
  rollPickupContents,
} from "./pickups";
import { Rng } from "./rng";
import { PLAYER_SIZE, SPAWN_POINTS, pickSpawnPoint } from "./spawnPoints";
import { WEAPONS, pelletYawOffsets } from "./weapons";
import { vec3 } from "./vec3";

describe("sweepSegmentAABB", () => {
  const box = aabbFromCenterSize(vec3(0, 0, 0), vec3(1, 1, 1));

  it("finds the entry time of a segment crossing a box", () => {
    const t = sweepSegmentAABB(vec3(-2, 0, 0), vec3(2, 0, 0), box);
    expect(t).toBeCloseTo(0.375); // enters at x = -0.5
  });

  it("misses a segment passing beside the box", () => {
    expect(sweepSegmentAABB(vec3(-2, 0, 2), vec3(2, 0, 2), box)).toBeNull();
  });

  it("misses a segment that stops short", () => {
    expect(sweepSegmentAABB(vec3(-2, 0, 0), vec3(-1, 0, 0), box)).toBeNull();
  });

  it("reports t = 0 for a segment starting inside", () => {
    expect(sweepSegmentAABB(vec3(0, 0, 0), vec3(2, 0, 0), box)).toBe(0);
  });

  it("handles axis-parallel segments", () => {
    expect(sweepSegmentAABB(vec3(0.2, -3, 0.2), vec3(0.2, 3, 0.2), box)).toBeCloseTo(
      2.5 / 6
    );
  });
});

describe("rotated boxes", () => {
  // 1 x 1 footprint at the origin. Turned 45 degrees it becomes a diamond
  // reaching sqrt(0.5) ~ 0.707 along the axes, but only 0.5 along the diagonals.
  const box = aabbFromCenterSize(vec3(0, 1, 0), vec3(1, 2, 1));
  const quarter = Math.PI / 4;

  it("contains points the axis-aligned box would miss, and vice versa", () => {
    // On the x axis, past the unrotated face but inside the diamond
    expect(rotatedAabbContains(box, 0, vec3(0.6, 1, 0))).toBe(false);
    expect(rotatedAabbContains(box, quarter, vec3(0.6, 1, 0))).toBe(true);
    // In the unrotated corner, outside the diamond
    expect(rotatedAabbContains(box, 0, vec3(0.45, 1, 0.45))).toBe(true);
    expect(rotatedAabbContains(box, quarter, vec3(0.45, 1, 0.45))).toBe(false);
  });

  it("sweeps against the rotated shape", () => {
    // Grazing shot at z = 0.6: misses the square, clips the diamond
    const from = vec3(-3, 1, 0.6);
    const to = vec3(3, 1, 0.6);
    expect(sweepSegmentRotatedAABB(from, to, box, 0)).toBeNull();
    expect(sweepSegmentRotatedAABB(from, to, box, quarter)).not.toBeNull();
  });

  it("is identical to the plain sweep at yaw 0", () => {
    const from = vec3(-2, 1, 0);
    const to = vec3(2, 1, 0);
    expect(sweepSegmentRotatedAABB(from, to, box, 0)).toBe(
      sweepSegmentAABB(from, to, box)
    );
  });

  it("is periodic in the yaw", () => {
    const p = vec3(0.6, 1, 0);
    expect(rotatedAabbContains(box, quarter + Math.PI, p)).toBe(true);
    expect(rotatedAabbContains(box, Math.PI / 2, p)).toBe(false);
  });
});

describe("playerHitbox", () => {
  it("is one box shared by the point test and the collider", () => {
    const pos = vec3(4, 1, -2);
    const hitbox = playerHitbox(pos, Math.PI / 4);
    const collider = playerCollider(pos, Math.PI / 4, "bob");
    expect(collider.box).toEqual(hitbox.box);
    expect(collider.yaw).toBe(hitbox.yaw);
    expect(collider.tag).toBe("bob");
    expect(playerHitboxContains(hitbox, vec3(4.6, 1, -2))).toBe(true);
    expect(playerHitboxContains(hitbox, vec3(4.45, 1, -1.55))).toBe(false);
  });
});

describe("aabbFromRotatedBox", () => {
  it("encloses a box rotated 45 degrees", () => {
    const b = aabbFromRotatedBox(vec3(0, 1, 0), vec3(2, 2, 2), Math.PI / 4);
    expect(b.max.x).toBeCloseTo(Math.SQRT2);
    expect(b.min.z).toBeCloseTo(-Math.SQRT2);
    expect(b.min.y).toBe(0);
  });
});

describe("projectile", () => {
  it("a bullet at 30 u/s stepped at 20 Hz cannot tunnel through a 1-wide box", () => {
    const wall: Collider<string> = {
      box: aabbFromCenterSize(vec3(5, 1, 0), vec3(1, 2, 1)),
      tag: "wall",
    };
    const [bullet] = spawnPellets(() => 1, "me", WEAPONS.pistol, vec3(0, 1, 0), vec3(1, 0, 0));

    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) {
      ({ hit } = integrateProjectile(bullet, 1 / 20, [wall]));
    }
    expect(hit).not.toBeNull();
    expect(hit!.collider.tag).toBe("wall");
    expect(hit!.point.x).toBeCloseTo(4.5);
  });

  it("skips excluded colliders and expires at max range", () => {
    const self: Collider<string> = {
      box: aabbFromCenterSize(vec3(0, 1, 0), vec3(1, 2, 1)),
      tag: "me",
    };
    const [bullet] = spawnPellets(() => 1, "me", WEAPONS.pistol, vec3(0, 1, 0), vec3(0, 0, -1));
    let expired = false;
    let steps = 0;
    while (!expired && steps < 1000) {
      ({ expired } = integrateProjectile(bullet, 1 / 20, [self], (c) => c.tag === "me"));
      steps += 1;
    }
    expect(steps).toBe(60); // 90 units / (30 u/s * 0.05 s)
  });

  it("fans shotgun pellets symmetrically", () => {
    expect(pelletYawOffsets(WEAPONS.shotgun)).toEqual([-0.1, 0, 0.1]);
    const pellets = spawnPellets(() => 0, "me", WEAPONS.shotgun, vec3(), vec3(0, 0, -1));
    expect(pellets).toHaveLength(3);
    expect(pellets[0].direction.x).toBeCloseTo(-pellets[2].direction.x);
  });
});

describe("map", () => {
  it("is deterministic for a given seed", () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(a).toEqual(b);
    expect(generateMap(43)).not.toEqual(a);
  });

  it("gives every crate a unique id and a sane box", () => {
    const map = generateMap();
    const ids = new Set(map.crates.map((c) => c.id));
    expect(ids.size).toBe(map.crates.length);
    for (const crate of map.crates) {
      const box = crateBox(crate);
      expect(box.max.x - box.min.x).toBeCloseTo(crate.size);
    }
  });

  it("does not plant trees inside crates", () => {
    const map = generateMap();
    for (const tree of map.trees) {
      for (const crate of map.crates) {
        const box = crateBox(crate);
        const inside =
          tree.position.x > box.min.x &&
          tree.position.x < box.max.x &&
          tree.position.z > box.min.z &&
          tree.position.z < box.max.z;
        expect(inside).toBe(false);
      }
    }
  });

  it("builds solid geometry with stable, unique ids and tree trunks included", () => {
    const map = generateMap();
    const solid = solidColliders(map);
    const ids = solid.map((c) => c.tag.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(solid).toEqual(solidColliders(generateMap()));

    const trunks = solid.filter((c) => c.tag.id.startsWith("tree-"));
    expect(trunks).toHaveLength(map.trees.length);
    const trunk = trunks[0].box;
    expect(trunk.max.x - trunk.min.x).toBeCloseTo(
      TREE_TRUNK_SIZE.x * map.trees[0].scale
    );
    expect(trunk.min.y).toBeCloseTo(map.trees[0].position.y);

    for (const kind of ["wall-0", "shop", "light-0"]) {
      expect(ids).toContain(kind);
    }
    for (const car of map.cars) expect(ids).toContain(car.id);
  });

  it("keeps bushes and cones movement-only, off the solid list", () => {
    const map = generateMap();
    const soft = movementOnlyColliders(map);
    expect(soft).toHaveLength(map.bushes.length + map.cones.length);
    const solidIds = new Set(solidColliders(map).map((c) => c.tag.id));
    for (const { id } of soft) expect(solidIds.has(id)).toBe(false);
  });

  it("leaves every spawn point clear of solid and movement-only geometry", () => {
    const map = generateMap();
    const obstacles = [
      ...solidColliders(map).map((c) => c.box),
      ...movementOnlyColliders(map).map((c) => c.box),
      ...map.crates.map(crateBox),
    ];
    for (const spawn of SPAWN_POINTS) {
      const player = aabbFromCenterSize(spawn, PLAYER_SIZE);
      expect(obstacles.some((box) => aabbIntersects(player, box))).toBe(false);
    }
  });
});

describe("rng", () => {
  it("is repeatable", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect([a.next(), a.next(), a.int(10)]).toEqual([b.next(), b.next(), b.int(10)]);
  });
});

describe("pickSpawnPoint", () => {
  it("prefers the point farthest from other players", () => {
    const spot = pickSpawnPoint([vec3(0, 1, 0), vec3(12, 1, -4)]);
    expect(spot).not.toEqual(vec3(0, 1, 0));
    expect(spot).not.toEqual(vec3(12, 1, -4));
  });
});

describe("grenade", () => {
  const DT = 1 / 20;

  it("follows an arc and bounces off the ground, losing energy", () => {
    const g = spawnGrenade("g", "alice", vec3(0, 1, 0), vec3(0, 0, -1));
    expect(g.velocity.y).toBeGreaterThan(0);

    let bounced = false;
    let peak = g.position.y;
    for (let i = 0; i < 60 && !bounced; i++) {
      const bounce = integrateGrenade(g, DT, []);
      peak = Math.max(peak, g.position.y);
      if (bounce) {
        bounced = true;
        expect(bounce.collider).toBeNull();
        expect(bounce.normal).toEqual(vec3(0, 1, 0));
        expect(g.velocity.y).toBeGreaterThan(0); // moving up again
        expect(g.velocity.y).toBeLessThan(GRENADE.throwLift);
        expect(g.position.y).toBeCloseTo(GRENADE.radius, 2);
      }
    }
    expect(bounced).toBe(true);
    expect(peak).toBeGreaterThan(1);
    expect(g.position.z).toBeLessThan(-3); // travelled forward
  });

  it("bounces back off a wall", () => {
    const wall: Collider<string> = {
      box: aabbFromCenterSize(vec3(0, 1, -3), vec3(10, 2, 0.5)),
      tag: "wall",
    };
    const g = spawnGrenade("g", "alice", vec3(0, 1, 0), vec3(0, 0, -1));
    g.velocity = vec3(0, 0, -10); // flat throw for a clean test

    let bounce = null;
    for (let i = 0; i < 20 && !bounce; i++) bounce = integrateGrenade(g, DT, [wall]);

    expect(bounce?.collider?.tag).toBe("wall");
    expect(bounce?.normal).toEqual(vec3(0, 0, 1));
    expect(g.velocity.z).toBeGreaterThan(0);
    expect(g.velocity.z).toBeCloseTo(10 * GRENADE.restitution, 5);
  });

  it("comes to rest and detonates when the fuse runs out", () => {
    const g = spawnGrenade("g", "alice", vec3(0, 0.2, 0), vec3(0, 0, -1));
    g.velocity = vec3(0, 0, 0);
    let ticks = 0;
    while (g.fuse > 0) {
      integrateGrenade(g, DT, []);
      ticks++;
    }
    const expected = Math.ceil(GRENADE.fuse / DT);
    expect(ticks).toBeGreaterThanOrEqual(expected);
    expect(ticks).toBeLessThanOrEqual(expected + 1); // float accumulation
    expect(g.velocity).toEqual(vec3(0, 0, 0));
    expect(g.position.y).toBeCloseTo(GRENADE.radius, 2);
  });

  it("blast damage falls off linearly to zero at the radius", () => {
    const c = vec3(0, 0, 0);
    expect(blastDamage(c, c)).toBe(GRENADE.maxDamage);
    expect(blastDamage(c, vec3(GRENADE.blastRadius / 2, 0, 0))).toBe(
      Math.round(GRENADE.maxDamage / 2)
    );
    expect(blastDamage(c, vec3(GRENADE.blastRadius, 0, 0))).toBe(0);
    expect(blastDamage(c, vec3(0, 0, 50))).toBe(0);
  });
});

describe("pickups", () => {
  it("reach is measured on the ground plane", () => {
    const pickup = vec3(0, 0.5, 0);
    expect(isWithinPickupReach(vec3(1, 1, 1), pickup)).toBe(true);
    expect(isWithinPickupReach(vec3(PICKUP_REACH + 0.1, 1, 0), pickup)).toBe(false);
  });

  it("spawns clear of blockers and players", () => {
    const rng = new Rng(3);
    const blocker = aabbFromCenterSize(vec3(0, 0.5, 0), vec3(200, 1, 20)); // wide bar
    const player = vec3(20, 1, 20);
    for (let i = 0; i < 20; i++) {
      const spot = findPickupSpawnPosition(rng, [blocker], [player]);
      expect(spot).not.toBeNull();
      expect(Math.abs(spot!.z)).toBeGreaterThan(10);
      expect(Math.hypot(spot!.x - player.x, spot!.z - player.z)).toBeGreaterThanOrEqual(10);
    }
  });

  it("gives up when nothing fits", () => {
    const everywhere = aabbFromCenterSize(vec3(0, 0.5, 0), vec3(400, 4, 400));
    expect(findPickupSpawnPosition(new Rng(1), [everywhere], [])).toBeNull();
  });

  it("rolls valid contents", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 20; i++) {
      const spec = rollPickupContents(rng, `p${i}`, vec3(0, 0.5, 0));
      expect(spec.amount).toBeGreaterThan(0);
      if (spec.kind === "ammo") expect(WEAPONS[spec.weaponId]).toBeDefined();
    }
  });
});
