import { describe, expect, it } from "vitest";
import {
  type AABB,
  aabbFromCenterSize,
  aabbFromRotatedBox,
  aabbIntersects,
  rotatedAabbContains,
  sweepSegmentAABB,
  sweepSegmentRotatedAABB,
} from "./aabb";
import { playerCollider, playerHitbox, playerHitboxContains } from "./playerHitbox";
import {
  CLOUD_EFFECTS,
  CLOUD_KINDS,
  GRENADE,
  GRENADE_EFFECTS,
  GRENADE_KINDS,
  GRENADE_LOADOUT,
  blastDamage,
  cloudContains,
  cloudKindOf,
  cloudObscures,
  flashIntensity,
  integrateGrenade,
  isGrenadeKind,
  shattersOnImpact,
  spawnCloud,
  spawnGrenade,
} from "./grenade";
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
import {
  PLAYER_SIZE,
  SPAWN_POINTS,
  facingCenterYaw,
  pickSpawnPoint,
  spawnPointsFor,
} from "./spawnPoints";
import { MAX_TEAM_SIZE, pickTeam } from "./teams";
import { WEAPONS, pelletYawOffsets } from "./weapons";
import { vec3 } from "./vec3";
import {
  cloneLevelDocument,
  levelFromMap,
  mapFromLevel,
  parseLevelDocument,
  serializeLevelDocument,
  validateLevel,
} from "./level";

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

describe("serialized levels", () => {
  it("round-trips the generated map without changing gameplay geometry", () => {
    const level = levelFromMap(generateMap());
    const parsed = parseLevelDocument(JSON.parse(serializeLevelDocument(level)));
    const restored = mapFromLevel(parsed);

    expect(restored).toEqual(generateMap());
    expect(cloneLevelDocument(level)).toEqual(level);
  });

  it("rejects duplicate IDs and blocked spawn points", () => {
    const level = levelFromMap(generateMap());
    level.objects[0].id = level.objects[1].id;
    const duplicateDiagnostics = validateLevel(level);
    expect(
      duplicateDiagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate"))
    ).toBe(true);

    const blockedLevel = levelFromMap(generateMap());
    blockedLevel.spawnPoints[0].position = { x: 0, y: 1, z: 0 }; // inside the shop
    const blockedDiagnostics = validateLevel(blockedLevel);
    expect(
      blockedDiagnostics.some((diagnostic) =>
        diagnostic.message.includes("overlaps gameplay")
      )
    ).toBe(true);
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

    for (const kind of ["wall-north", "shop", "warehouse-flank-s", "tenement-flank-s", "light-0"]) {
      expect(ids).toContain(kind);
    }
    for (const car of map.cars) expect(ids).toContain(car.id);
  });

  it("keeps bushes and cones movement-only, off the solid list", () => {
    const map = generateMap();
    const soft = movementOnlyColliders(map);
    expect(soft).toHaveLength(map.bushes.length + map.cones.length + map.props.filter((prop) => ["trash-bag", "fence"].includes(prop.type)).length);
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
      const player = aabbFromCenterSize(spawn.position, PLAYER_SIZE);
      expect(obstacles.some((box) => aabbIntersects(player, box))).toBe(false);
    }
  });

  it("gives each team five spawn points in its own spawn street", () => {
    const map = generateMap();
    const south = map.spawnPoints.filter((p) => p.position.z < -28);
    const north = map.spawnPoints.filter((p) => p.position.z > 28);
    expect(south).toHaveLength(MAX_TEAM_SIZE);
    expect(north).toHaveLength(MAX_TEAM_SIZE);
    expect(south.length + north.length).toBe(map.spawnPoints.length);
    // Blue owns the south street, red the north one
    expect(south.every((p) => p.team === "blue")).toBe(true);
    expect(north.every((p) => p.team === "red")).toBe(true);
    expect(spawnPointsFor("blue", map.spawnPoints)).toEqual(south);
    expect(spawnPointsFor("red", map.spawnPoints)).toEqual(north);
  });

  it("requires every spawn point to name a team", () => {
    const level = levelFromMap(generateMap());
    (level.spawnPoints[0] as { team: unknown }).team = "green";
    const diagnostics = validateLevel(level);
    expect(diagnostics.some((d) => d.path.endsWith(".team") && d.severity === "error")).toBe(
      true
    );
  });

  it("flags a level with a team that has no spawn point, and warns on uneven counts", () => {
    const noRed = levelFromMap(generateMap());
    for (const spawn of noRed.spawnPoints) spawn.team = "blue";
    expect(
      validateLevel(noRed).some(
        (d) => d.severity === "error" && d.message.includes("red spawn point")
      )
    ).toBe(true);

    const uneven = levelFromMap(generateMap());
    uneven.spawnPoints[0].team = "red";
    const warnings = validateLevel(uneven).filter((d) => d.severity === "warning");
    expect(warnings.some((d) => d.message.includes("blue"))).toBe(true);
    expect(warnings.some((d) => d.message.includes("red"))).toBe(true);
    // Warnings do not make the level unloadable
    expect(() => parseLevelDocument(uneven)).not.toThrow();
  });

  it("faces each spawn point toward the map centre", () => {
    expect(facingCenterYaw({ x: 0, y: 1, z: -34 })).toBeCloseTo(Math.PI);
    expect(facingCenterYaw({ x: 0, y: 1, z: 34 })).toBeCloseTo(0);
    expect(facingCenterYaw({ x: 16, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it("is the same map for both teams: every obstacle has a 180° twin", () => {
    const map = generateMap();
    const boxes = [
      ...solidColliders(map).map((c) => c.box),
      ...movementOnlyColliders(map).map((c) => c.box),
      ...map.crates.map(crateBox),
    ];
    const key = (box: AABB) =>
      [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
        .map((v) => v.toFixed(4))
        .join(",");
    const seen = new Set(boxes.map(key));
    for (const box of boxes) {
      const twin: AABB = {
        min: vec3(-box.max.x, box.min.y, -box.max.z),
        max: vec3(-box.min.x, box.max.y, -box.min.z),
      };
      expect(seen.has(key(twin))).toBe(true);
    }
  });

  it("does not let hand-placed cover interpenetrate", () => {
    const map = generateMap();
    // Boundary walls meet at the corners and fence runs share their posts on purpose.
    const deliberate = (id: string) =>
      id.startsWith("wall-") || id.startsWith("fence-") || id.startsWith("gate-");
    const boxes = [
      ...solidColliders(map).map((c) => ({ id: c.tag.id, box: c.box })),
      ...movementOnlyColliders(map),
      ...map.crates.map((c) => ({ id: c.id, box: crateBox(c) })),
    ].filter(({ id }) => !deliberate(id));
    const overlapAlong = (a: AABB, b: AABB, axis: "x" | "y" | "z") =>
      Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
    const interpenetrating: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Parts of one prop (a forklift's body and forks) may touch each other.
        if (a.id.split(":")[0] === b.id.split(":")[0]) continue;
        const shared = (["x", "y", "z"] as const).every(
          (axis) => overlapAlong(a.box, b.box, axis) > 1e-6
        );
        if (shared) interpenetrating.push(`${a.id} x ${b.id}`);
      }
    }
    expect(interpenetrating).toEqual([]);
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

  it("stays inside the team's own zone when given the team's points", () => {
    // Everyone is camped on the south street; a red player still spawns north.
    const occupied = spawnPointsFor("blue").map((p) => p.position);
    const spot = pickSpawnPoint(occupied, spawnPointsFor("red"));
    expect(spot.z).toBeGreaterThan(28);
  });

  it("refuses an empty point list", () => {
    expect(() => pickSpawnPoint([], [])).toThrow();
  });
});

describe("pickTeam", () => {
  it("fills the smaller team, blue on a tie", () => {
    expect(pickTeam({ blue: 0, red: 0 })).toBe("blue");
    expect(pickTeam({ blue: 1, red: 0 })).toBe("red");
    expect(pickTeam({ blue: 1, red: 1 })).toBe("blue");
    expect(pickTeam({ blue: 3, red: 1 })).toBe("red");
  });

  it("only offers a team with room, and none when the room is full", () => {
    expect(pickTeam({ blue: MAX_TEAM_SIZE, red: 2 })).toBe("red");
    expect(pickTeam({ blue: 0, red: MAX_TEAM_SIZE })).toBe("blue");
    expect(pickTeam({ blue: MAX_TEAM_SIZE, red: MAX_TEAM_SIZE })).toBeNull();
  });
});

describe("grenade", () => {
  const DT = 1 / 20;

  it("follows an arc and bounces off the ground, losing energy", () => {
    const g = spawnGrenade("g", "alice", "frag", vec3(0, 1, 0), vec3(0, 0, -1));
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
    const g = spawnGrenade("g", "alice", "frag", vec3(0, 1, 0), vec3(0, 0, -1));
    g.velocity = vec3(0, 0, -10); // flat throw for a clean test

    let bounce = null;
    for (let i = 0; i < 20 && !bounce; i++) bounce = integrateGrenade(g, DT, [wall]);

    expect(bounce?.collider?.tag).toBe("wall");
    expect(bounce?.normal).toEqual(vec3(0, 0, 1));
    expect(g.velocity.z).toBeGreaterThan(0);
    expect(g.velocity.z).toBeCloseTo(10 * GRENADE.restitution, 5);
  });

  it("comes to rest and detonates when the fuse runs out", () => {
    const g = spawnGrenade("g", "alice", "frag", vec3(0, 0.2, 0), vec3(0, 0, -1));
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

  it("knows its kinds and rejects anything else off the wire", () => {
    for (const kind of GRENADE_KINDS) expect(isGrenadeKind(kind)).toBe(true);
    expect(isGrenadeKind("nuke")).toBe(false);
    expect(isGrenadeKind(undefined)).toBe(false);
    expect(isGrenadeKind(1)).toBe(false);
  });

  it("every kind flies the same way", () => {
    const flights = GRENADE_KINDS.map((kind) => {
      const g = spawnGrenade("g", "alice", kind, vec3(0, 1, 0), vec3(0, 0, -1));
      for (let i = 0; i < 30; i++) integrateGrenade(g, DT, []);
      return g.position;
    });
    for (const position of flights) expect(position).toEqual(flights[0]);
  });

  it("only the molotov goes off on impact; the rest wait for the fuse", () => {
    expect(GRENADE_KINDS.filter(shattersOnImpact)).toEqual(["molotov"]);
    const g = spawnGrenade("g", "alice", "molotov", vec3(0, 1, 0), vec3(0, 0, -1));
    let bounce = null;
    let steps = 0;
    while (!bounce && steps++ < 100) bounce = integrateGrenade(g, DT, []);
    expect(bounce).not.toBeNull();
    expect(g.fuse).toBeGreaterThan(0); // the bottle hit the ground well before its fuse
  });

  it("maps each grenade kind to the cloud it leaves, and every cloud kind back to a grenade", () => {
    expect(cloudKindOf("frag")).toBeNull();
    expect(cloudKindOf("flash")).toBeNull();
    expect(cloudKindOf("smoke")).toBe("smoke");
    expect(cloudKindOf("gas")).toBe("gas");
    expect(cloudKindOf("molotov")).toBe("fire");
    for (const kind of CLOUD_KINDS) expect(cloudKindOf(CLOUD_EFFECTS[kind].source)).toBe(kind);
    expect(CLOUD_EFFECTS.smoke.dps).toBe(0);
    expect(CLOUD_EFFECTS.fire.dps).toBeGreaterThan(CLOUD_EFFECTS.gas.dps);
  });

  it("fire is a tighter, shorter, hotter pool than gas", () => {
    const fire = spawnCloud("f", { ownerId: "alice", position: vec3(0, 0.15, 0) }, "fire");
    expect(fire.remaining).toBe(GRENADE_EFFECTS.molotov.duration);
    expect(cloudContains(fire, vec3(GRENADE_EFFECTS.molotov.radius - 0.1, 1, 0))).toBe(true);
    expect(cloudContains(fire, vec3(GRENADE_EFFECTS.molotov.radius + 0.1, 1, 0))).toBe(false);
    // Fire is not smoke: it hides nothing.
    expect(cloudObscures(vec3(-10, 5, 0), vec3(10, 1, 0), fire)).toBe(false);
  });

  it("spawn loadout: frags to start, gas and molotovs only as loot, every pickup grants some", () => {
    expect(GRENADE_LOADOUT.frag.start).toBeGreaterThan(0);
    expect(GRENADE_LOADOUT.gas.start).toBe(0);
    expect(GRENADE_LOADOUT.molotov.start).toBe(0);
    for (const kind of GRENADE_KINDS) expect(GRENADE_LOADOUT[kind].pickup).toBeGreaterThan(0);
  });

  it("a cloud sits on the ground where the grenade went off and lasts its kind's duration", () => {
    const grenade = { ownerId: "alice", position: vec3(3, 0.15, -4) };
    const smoke = spawnCloud("c", grenade, "smoke");
    expect(smoke).toMatchObject({
      kind: "smoke",
      ownerId: "alice",
      position: vec3(3, 0, -4),
      remaining: GRENADE_EFFECTS.smoke.duration,
    });
    expect(spawnCloud("c", grenade, "gas").remaining).toBe(GRENADE_EFFECTS.gas.duration);
  });

  it("a cloud contains body centres inside its cylinder only", () => {
    const gas = spawnCloud("c", { ownerId: "alice", position: vec3(0, 0, 0) }, "gas");
    const r = GRENADE_EFFECTS.gas.radius;
    expect(cloudContains(gas, vec3(0, 1, 0))).toBe(true);
    expect(cloudContains(gas, vec3(r - 0.1, 1, 0))).toBe(true);
    expect(cloudContains(gas, vec3(r + 0.1, 1, 0))).toBe(false);
    expect(cloudContains(gas, vec3(0, 6, 0))).toBe(false); // on a roof above it
  });

  it("smoke hides what stands behind it; gas does not", () => {
    const at = vec3(0, 0, 0);
    const smoke = spawnCloud("s", { ownerId: "alice", position: at }, "smoke");
    const gas = spawnCloud("g", { ownerId: "alice", position: at }, "gas");
    const camera = vec3(0, 12, 12);
    const behind = vec3(0, 1, -2);
    const beside = vec3(GRENADE_EFFECTS.smoke.radius * 3, 1, 0);

    expect(cloudObscures(camera, behind, smoke)).toBe(true);
    expect(cloudObscures(camera, beside, smoke)).toBe(false);
    expect(cloudObscures(camera, behind, gas)).toBe(false);
    // A cloud about to vanish no longer hides anything.
    expect(cloudObscures(camera, behind, { ...smoke, remaining: 0.5 })).toBe(false);
  });

  it("flash intensity falls off linearly to zero at the radius", () => {
    const c = vec3(0, 0, 0);
    const { radius } = GRENADE_EFFECTS.flash;
    expect(flashIntensity(c, c)).toBe(1);
    expect(flashIntensity(c, vec3(radius / 2, 0, 0))).toBeCloseTo(0.5, 2);
    expect(flashIntensity(c, vec3(radius, 0, 0))).toBe(0);
    expect(flashIntensity(c, vec3(0, 0, 50))).toBe(0);
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
