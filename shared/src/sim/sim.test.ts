import { describe, expect, it } from "vitest";
import { aabbFromCenterSize, aabbFromRotatedBox, sweepSegmentAABB } from "./aabb";
import { generateMap, crateBox } from "./mapLayout";
import { integrateProjectile, spawnPellets, type Collider } from "./projectile";
import { Rng } from "./rng";
import { pickSpawnPoint } from "./spawnPoints";
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
