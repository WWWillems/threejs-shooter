import { describe, expect, it } from "vitest";
import type {
  GrenadeSnapshot,
  PlayerSnapshot,
  WorldSnapshot,
} from "@threejs-shooter/shared";
import { Replication, lerpAngle } from "./Replication";

/** Marker for "reported at the snapshot's own serverTime"; `snapshot()` fills it in. */
const AT_SNAPSHOT = -1;

const player = (
  id: string,
  x: number,
  rotation = 0,
  extra: Partial<PlayerSnapshot> = {}
): PlayerSnapshot => ({
  id,
  userId: id,
  name: id,
  team: "blue",
  status: "alive",
  hp: 100,
  position: { x, y: 1, z: 0 },
  rotation,
  positionAt: AT_SNAPSHOT,
  ...extra,
});

const snapshot = (
  tick: number,
  serverTime: number,
  players: PlayerSnapshot[],
  grenades: GrenadeSnapshot[] = []
): WorldSnapshot => ({
  tick,
  serverTime,
  players: players.map((p) =>
    p.positionAt === AT_SNAPSHOT ? { ...p, positionAt: serverTime } : p
  ),
  grenades,
  clouds: [],
  match: { phase: "active", phaseEndsAt: null, teamScores: { blue: 0, red: 0 } },
});

describe("Replication", () => {
  it("preserves crouch, airborne and reload presentation through interpolation", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0, 0, { pose: { crouched: false, grounded: true, reload: 0 } })]), 1000);
    const pose = { crouched: true, grounded: false, reload: .45 };
    r.push(snapshot(2, 1050, [player("a", 1, 0, { pose })]), 1050);
    expect(r.sampleAtServerTime(1025).get("a")!.pose).toEqual(pose);
    expect(r.sampleAtServerTime(1050).get("a")!.pose).toEqual(pose);
  });

  it("returns nothing before the first snapshot", () => {
    const r = new Replication();
    expect(r.sample(0).size).toBe(0);
  });

  it("interpolates position and rotation between two snapshots", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0, 0)]), 1000);
    r.push(snapshot(2, 1050, [player("a", 10, 1)]), 1050);

    const a = r.sampleAtServerTime(1025).get("a")!;
    expect(a.position.x).toBeCloseTo(5);
    expect(a.rotation).toBeCloseTo(0.5);
  });

  it("clamps to the newest snapshot instead of extrapolating", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0)]), 1000);
    r.push(snapshot(2, 1050, [player("a", 10)]), 1050);

    expect(r.sampleAtServerTime(5000).get("a")!.position.x).toBe(10);
    expect(r.sampleAtServerTime(0).get("a")!.position.x).toBe(0);
  });

  it("renders interpolationDelayMs behind server time", () => {
    const r = new Replication({ interpolationDelayMs: 100 });
    // Server clock is 500 ms ahead of local.
    r.push(snapshot(1, 1500, [player("a", 0)]), 1000);
    r.push(snapshot(2, 1600, [player("a", 10)]), 1100);

    // local 1150 -> server 1650 -> render at 1550 -> halfway
    expect(r.sample(1150).get("a")!.position.x).toBeCloseTo(5);
  });

  it("includes players that appear only in the newer snapshot", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0)]), 1000);
    r.push(snapshot(2, 1050, [player("a", 10), player("b", 3)]), 1050);

    const states = r.sampleAtServerTime(1025);
    expect(states.get("b")!.position.x).toBe(3);
  });

  it("ignores out-of-order snapshots", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(2, 1050, [player("a", 10)]), 1050);
    r.push(snapshot(1, 1000, [player("a", 0)]), 1060);
    expect(r.latest!.tick).toBe(2);
  });

  it("interpolates between reports, not between snapshots repeating a stale one", () => {
    // Reports land every 100 ms but snapshots go out every 50 ms, so every
    // other snapshot repeats the previous report.
    const r = new Replication({ interpolationDelayMs: 0 });
    const report = (x: number, at: number) => player("a", x, 0, { positionAt: at });
    r.push(snapshot(1, 1000, [report(0, 1000)]), 1000);
    r.push(snapshot(2, 1050, [report(0, 1000)]), 1050); // stale repeat
    r.push(snapshot(3, 1100, [report(10, 1100)]), 1100);
    r.push(snapshot(4, 1150, [report(10, 1100)]), 1150); // stale repeat
    r.push(snapshot(5, 1200, [report(20, 1200)]), 1200);

    // Linear the whole way: no 50 ms holds between the reports.
    expect(r.sampleAtServerTime(1025).get("a")!.position.x).toBeCloseTo(2.5);
    expect(r.sampleAtServerTime(1075).get("a")!.position.x).toBeCloseTo(7.5);
    expect(r.sampleAtServerTime(1125).get("a")!.position.x).toBeCloseTo(12.5);
    expect(r.sampleAtServerTime(1175).get("a")!.position.x).toBeCloseTo(17.5);
  });

  it("holds a player who keeps reporting the same spot, then moves off cleanly", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    const report = (x: number, at: number) => player("a", x, 0, { positionAt: at });
    r.push(snapshot(1, 1000, [report(0, 1000)]), 1000);
    r.push(snapshot(2, 1050, [report(0, 1050)]), 1050);
    r.push(snapshot(3, 1100, [report(0, 1100)]), 1100);
    r.push(snapshot(4, 1150, [report(5, 1150)]), 1150);

    expect(r.sampleAtServerTime(1075).get("a")!.position.x).toBe(0);
    expect(r.sampleAtServerTime(1125).get("a")!.position.x).toBeCloseTo(2.5);
  });

  it("does not extrapolate past the newest report", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0)]), 1000);
    r.push(snapshot(2, 1050, [player("a", 10)]), 1050);
    r.push(snapshot(3, 1100, [player("a", 10, 0, { positionAt: 1050 })]), 1100);

    expect(r.sampleAtServerTime(1200).get("a")!.position.x).toBe(10);
  });

  it("forgets a player's track once they leave the snapshots", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    r.push(snapshot(1, 1000, [player("a", 0), player("b", 0)]), 1000);
    r.push(snapshot(2, 1050, [player("a", 1)]), 1050);

    expect(r.sampleAtServerTime(1050).has("b")).toBe(false);
  });

  it("interpolates grenade positions and drops grenades that vanished", () => {
    const r = new Replication({ interpolationDelayMs: 0 });
    const g = (x: number, y: number): GrenadeSnapshot => ({
      id: "g1",
      kind: "frag",
      ownerId: "a",
      position: { x, y, z: 0 },
    });
    r.push(snapshot(1, 1000, [player("a", 0)], [g(0, 2)]), 1000);
    r.push(snapshot(2, 1100, [player("a", 0)], [g(10, 0)]), 1100);
    r.push(snapshot(3, 1200, [player("a", 0)], []), 1200);

    const mid = r.sampleWorldAtServerTime(1050).grenades.get("g1")!;
    expect(mid.kind).toBe("frag");
    expect(mid.position.x).toBeCloseTo(5);
    expect(mid.position.y).toBeCloseTo(1);

    expect(r.sampleWorldAtServerTime(1150).grenades.size).toBe(0);
  });
});

describe("lerpAngle", () => {
  it("takes the short way around the circle", () => {
    const from = Math.PI - 0.1;
    const to = -Math.PI + 0.1;
    const mid = lerpAngle(from, to, 0.5);
    // Halfway across the +/- pi seam is pi (or -pi), not 0.
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
  });
});
