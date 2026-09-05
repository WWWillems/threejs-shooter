import type {
  GrenadeSnapshot,
  PlayerSnapshot,
  PlayerStatus,
  Vec3,
  WorldSnapshot,
} from "@threejs-shooter/shared";

/** Interpolated, render-ready state of one remote player. */
export interface ReplicatedPlayer {
  id: string;
  name: string;
  status: PlayerStatus;
  position: Vec3;
  rotation: number;
}

/** Interpolated, render-ready state of one grenade. */
export interface ReplicatedGrenade {
  id: string;
  ownerId: string;
  position: Vec3;
}

/** Everything `Replication.sample` can tell you about one instant. */
export interface ReplicatedWorld {
  players: Map<string, ReplicatedPlayer>;
  grenades: Map<string, ReplicatedGrenade>;
}

export interface ReplicationOptions {
  /** How far behind the newest snapshot to render, ms. Hides jitter; costs latency. */
  interpolationDelayMs?: number;
  /** How many snapshots to keep. */
  maxSnapshots?: number;
}

/**
 * Buffers world snapshots and samples a smooth world state at any point in
 * server time. Rendering happens `interpolationDelayMs` behind the newest
 * snapshot so there is (almost) always a pair to interpolate between.
 */
export class Replication {
  private readonly snapshots: WorldSnapshot[] = [];
  private readonly interpolationDelayMs: number;
  private readonly maxSnapshots: number;
  /** serverTime - localTime, smoothed. Null until the first snapshot. */
  private clockOffset: number | null = null;

  constructor(options: ReplicationOptions = {}) {
    this.interpolationDelayMs = options.interpolationDelayMs ?? 100;
    this.maxSnapshots = options.maxSnapshots ?? 32;
  }

  get latest(): WorldSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /** Record a snapshot. `localNow` is the local clock when it arrived. */
  push(snapshot: WorldSnapshot, localNow: number): void {
    const last = this.latest;
    if (last && snapshot.tick <= last.tick) return; // late or duplicate

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    const offset = snapshot.serverTime - localNow;
    this.clockOffset =
      this.clockOffset === null
        ? offset
        : this.clockOffset + (offset - this.clockOffset) * 0.1;
  }

  /** Server time we should be rendering at for the given local clock. */
  renderTime(localNow: number): number | null {
    if (this.clockOffset === null) return null;
    return localNow + this.clockOffset - this.interpolationDelayMs;
  }

  /** Players at local time `localNow`, interpolated. Empty before any snapshot. */
  sample(localNow: number): Map<string, ReplicatedPlayer> {
    return this.sampleWorld(localNow).players;
  }

  /** Players and grenades at local time `localNow`, interpolated. */
  sampleWorld(localNow: number): ReplicatedWorld {
    const t = this.renderTime(localNow);
    if (t === null) return { players: new Map(), grenades: new Map() };
    return this.sampleWorldAtServerTime(t);
  }

  /** Players at server time `t`, interpolated between the surrounding snapshots. */
  sampleAtServerTime(t: number): Map<string, ReplicatedPlayer> {
    return this.sampleWorldAtServerTime(t).players;
  }

  /** Players and grenades at server time `t`. */
  sampleWorldAtServerTime(t: number): ReplicatedWorld {
    if (this.snapshots.length === 0) {
      return { players: new Map(), grenades: new Map() };
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];

    // Clamp: no extrapolation beyond what the server has told us.
    if (t <= first.serverTime) return toStates(first);
    if (t >= last.serverTime) return toStates(last);

    // Find the pair [a, b] with a.serverTime <= t < b.serverTime.
    let hi = 1;
    while (this.snapshots[hi].serverTime <= t) hi += 1;
    const a = this.snapshots[hi - 1];
    const b = this.snapshots[hi];

    const span = b.serverTime - a.serverTime;
    const alpha = span > 0 ? (t - a.serverTime) / span : 1;

    const players = new Map<string, ReplicatedPlayer>();
    const previous = new Map(a.players.map((p) => [p.id, p]));
    for (const to of b.players) {
      const from = previous.get(to.id);
      players.set(to.id, from ? lerpPlayer(from, to, alpha) : toState(to));
    }

    const grenades = new Map<string, ReplicatedGrenade>();
    const previousGrenades = new Map(a.grenades.map((g) => [g.id, g]));
    for (const to of b.grenades) {
      const from = previousGrenades.get(to.id);
      grenades.set(to.id, {
        id: to.id,
        ownerId: to.ownerId,
        position: from ? lerpVec3(from.position, to.position, alpha) : to.position,
      });
    }

    return { players, grenades };
  }
}

function toStates(snapshot: WorldSnapshot): ReplicatedWorld {
  return {
    players: new Map(snapshot.players.map((p) => [p.id, toState(p)])),
    grenades: new Map(
      snapshot.grenades.map((g) => [g.id, toGrenadeState(g)])
    ),
  };
}

function toGrenadeState(g: GrenadeSnapshot): ReplicatedGrenade {
  return { id: g.id, ownerId: g.ownerId, position: g.position };
}

function lerpVec3(a: Vec3, b: Vec3, alpha: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

function toState(p: PlayerSnapshot): ReplicatedPlayer {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    position: p.position ?? { x: 0, y: 1, z: 0 },
    rotation: p.rotation,
  };
}

function lerpPlayer(
  from: PlayerSnapshot,
  to: PlayerSnapshot,
  alpha: number
): ReplicatedPlayer {
  const a = from.position ?? to.position ?? { x: 0, y: 1, z: 0 };
  const b = to.position ?? a;
  return {
    id: to.id,
    name: to.name,
    // Discrete fields snap to the newer snapshot.
    status: to.status,
    position: {
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
      z: a.z + (b.z - a.z) * alpha,
    },
    rotation: lerpAngle(from.rotation, to.rotation, alpha),
  };
}

/** Interpolate along the shortest arc so a wrap from +pi to -pi does not spin. */
export function lerpAngle(from: number, to: number, alpha: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return from + delta * alpha;
}
