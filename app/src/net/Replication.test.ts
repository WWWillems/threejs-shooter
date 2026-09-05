import { describe, expect, it } from "vitest";
import type { PlayerSnapshot, WorldSnapshot } from "@threejs-shooter/shared";
import { Replication, lerpAngle } from "./Replication";

const player = (
  id: string,
  x: number,
  rotation = 0,
  extra: Partial<PlayerSnapshot> = {}
): PlayerSnapshot => ({
  id,
  userId: id,
  name: id,
  status: "alive",
  position: { x, y: 1, z: 0 },
  rotation,
  ...extra,
});

const snapshot = (
  tick: number,
  serverTime: number,
  players: PlayerSnapshot[]
): WorldSnapshot => ({ tick, serverTime, players });

describe("Replication", () => {
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
