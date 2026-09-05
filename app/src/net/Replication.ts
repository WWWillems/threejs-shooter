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
 * One position report from a player, as seen through the snapshot stream.
 * Consecutive snapshots repeat a player's last report until a new one lands,
 * so a track holds only the distinct reports (keyed on `positionAt`).
 */
interface Keyframe {
  at: number;
  snap: PlayerSnapshot;
}

/**
 * Buffers world snapshots and samples a smooth world state at any point in
 * server time. Rendering happens `interpolationDelayMs` behind the newest
 * snapshot so there is (almost) always a pair to interpolate between.
 *
 * Players are interpolated between the moments their positions were actually
 * reported (`PlayerSnapshot.positionAt`), not between snapshots: a snapshot
 * that merely repeats a stale position would otherwise read as "stood still
 * for a tick", which shows up as stop-go motion. Grenades are server
 * simulated and fresh every tick, so they interpolate between snapshots.
 */
export class Replication {
  private readonly snapshots: WorldSnapshot[] = [];
  private readonly tracks = new Map<string, Keyframe[]>();
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
    this.recordKeyframes(snapshot);

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
    if (t <= first.serverTime) {
      return { players: this.samplePlayers(first, t), grenades: grenadeStates(first) };
    }
    if (t >= last.serverTime) {
      return { players: this.samplePlayers(last, t), grenades: grenadeStates(last) };
    }

    // Find the pair [a, b] with a.serverTime <= t < b.serverTime.
    let hi = 1;
    while (this.snapshots[hi].serverTime <= t) hi += 1;
    const a = this.snapshots[hi - 1];
    const b = this.snapshots[hi];

    const span = b.serverTime - a.serverTime;
    const alpha = span > 0 ? (t - a.serverTime) / span : 1;

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

    return { players: this.samplePlayers(b, t), grenades };
  }

  /** Append each player's report to its track if it is newer than the last one. */
  private recordKeyframes(snapshot: WorldSnapshot): void {
    const present = new Set<string>();
    for (const snap of snapshot.players) {
      present.add(snap.id);
      let track = this.tracks.get(snap.id);
      if (!track) {
        track = [];
        this.tracks.set(snap.id, track);
      }
      const newest = track[track.length - 1];
      if (newest && snap.positionAt <= newest.at) {
        // Same report as before; only the discrete fields (hp, status) may have moved on.
        newest.snap = snap;
        continue;
      }
      track.push({ at: snap.positionAt, snap });
      if (track.length > this.maxSnapshots) track.shift();
    }
    for (const id of this.tracks.keys()) {
      if (!present.has(id)) this.tracks.delete(id);
    }
  }

  /**
   * The players that exist in `membership` (the snapshot bracketing `t`),
   * each placed by interpolating its own reports around `t`.
   */
  private samplePlayers(
    membership: WorldSnapshot,
    t: number
  ): Map<string, ReplicatedPlayer> {
    const players = new Map<string, ReplicatedPlayer>();
    for (const snap of membership.players) {
      players.set(snap.id, this.samplePlayer(snap, t));
    }
    return players;
  }

  private samplePlayer(fallback: PlayerSnapshot, t: number): ReplicatedPlayer {
    const track = this.tracks.get(fallback.id);
    if (!track || track.length === 0) return toState(fallback);

    // Newest report at or before t.
    let i = track.length - 1;
    while (i > 0 && track[i].at > t) i -= 1;
    const from = track[i];
    const to = track[i + 1];

    // Hold when t precedes the first report or follows the newest one.
    if (!to || t <= from.at) return toState(from.snap);

    const alpha = (t - from.at) / (to.at - from.at);
    return lerpPlayer(from.snap, to.snap, alpha);
  }
}

function grenadeStates(snapshot: WorldSnapshot): Map<string, ReplicatedGrenade> {
  return new Map(snapshot.grenades.map((g) => [g.id, toGrenadeState(g)]));
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
