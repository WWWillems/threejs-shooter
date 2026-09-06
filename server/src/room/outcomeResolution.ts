import {
  aabbCenter,
  blastDamage,
  crateBox,
  flashIntensity,
  rocketBlastDamage,
  sweepProjectile,
  type Collider,
  type CrateSpec,
  type DamageSource,
  type GrenadeKind,
  type InteractionState,
  type PlayerStatus,
  type PropSpec,
  type StaticTag,
  type Team,
  type Vec3,
} from "@threejs-shooter/shared";

export type CombatColliderTag =
  | StaticTag
  | { kind: "crate"; id: string }
  | { kind: "interactive"; id: string }
  | { kind: "player"; id: string };

export interface CombatPlayerView {
  armor?: number;
  id: string;
  team: Team;
  status: PlayerStatus;
  hp: number;
  position?: Vec3;
}

export interface CombatCrateView {
  id: string;
  spec: CrateSpec;
  hp: number;
}

export interface CombatInteractionView {
  id: string;
  spec: PropSpec;
  state: InteractionState;
}

export interface CombatWorldView {
  players: readonly CombatPlayerView[];
  crates: readonly CombatCrateView[];
  interactions: readonly CombatInteractionView[];
  blockers: readonly Collider<CombatColliderTag>[];
}

export type CombatOperation =
  | {
      kind: "player-damaged";
      armor: number;
      shooterId: string;
      targetId: string;
      damage: number;
      hp: number;
      source: DamageSource;
      position: Vec3;
    }
  | {
      kind: "player-killed";
      killerId: string;
      victimId: string;
      source: DamageSource;
      killerTeam: Team | null;
      teamKill: boolean;
    }
  | {
      kind: "crate-damaged";
      crateId: string;
      damage: number;
      hp: number;
    }
  | {
      kind: "crate-destroyed";
      crateId: string;
      position: Vec3;
    }
  | {
      kind: "interactive-damaged";
      interactionId: string;
      damage: number;
      destroyed: boolean;
    }
  | {
      kind: "world-blast";
      id: string;
      position: Vec3;
    }
  | {
      kind: "world-arc";
      points: Vec3[];
    }
  | {
      kind: "grenade-exploded";
      grenadeId: string;
      grenadeKind: GrenadeKind;
      ownerId: string;
      position: Vec3;
      hits: { targetId: string; damage: number }[];
      flashed: { targetId: string; intensity: number }[];
    }
  | {
      kind: "cloud-created";
      cloudId: string;
      cloudKind: "smoke" | "gas" | "fire";
      ownerId: string;
      position: Vec3;
    }
  | {
      kind: "pickup-drop-request";
      position: Vec3;
    };

export interface CombatResolutionPlan {
  operations: CombatOperation[];
}

export interface ProjectileHitRequest {
  ownerId: string;
  weaponId: DamageSource;
  position: Vec3;
  target:
    | { kind: "player"; id: string }
    | { kind: "crate"; id: string }
    | { kind: "interactive"; id: string };
  damage: number;
}

export interface RocketBlastRequest {
  projectileId: number;
  ownerId: string;
  position: Vec3;
}

export interface ArcHitRequest {
  ownerId: string;
  weaponId: DamageSource;
  projectilePosition: Vec3;
  firstTargetId: string;
  damage: number;
}

export interface GrenadeExplosionRequest {
  grenadeId: string;
  kind: GrenadeKind;
  ownerId: string;
  position: Vec3;
}

interface WorkingPlayer extends CombatPlayerView {
  position?: Vec3;
}

interface WorkingCrate extends CombatCrateView {
  hp: number;
}

interface WorkingInteraction extends CombatInteractionView {
  state: InteractionState;
}

class WorkingCombatState {
  readonly players: Map<string, WorkingPlayer>;
  readonly crates: Map<string, WorkingCrate>;
  readonly interactions: Map<string, WorkingInteraction>;
  readonly operations: CombatOperation[] = [];

  constructor(readonly world: CombatWorldView) {
    this.players = new Map(
      world.players.map((player) => [
        player.id,
        { ...player, position: player.position ? { ...player.position } : undefined },
      ])
    );
    this.crates = new Map(
      world.crates.map((crate) => [crate.id, { ...crate, hp: crate.hp }])
    );
    this.interactions = new Map(
      world.interactions.map((interaction) => [
        interaction.id,
        {
          ...interaction,
          state: { ...interaction.state },
        },
      ])
    );
  }

  damagePlayer(
    shooterId: string,
    targetId: string,
    damage: number,
    source: DamageSource,
    position: Vec3
  ): void {
    const target = this.players.get(targetId);
    if (!target || target.status !== "alive" || !target.position || damage <= 0) return;

    const absorbed = Math.min(target.armor ?? 0, damage);
    target.armor = Math.max(0, (target.armor ?? 0) - absorbed);
    target.hp = Math.max(0, target.hp - (damage - absorbed));
    this.operations.push({
      kind: "player-damaged",
      armor: target.armor,
      shooterId,
      targetId,
      damage,
      hp: target.hp,
      source,
      position: { ...position },
    });

    if (target.hp > 0) return;

    target.status = "dead";
    const killer = this.players.get(shooterId);
    const isPlayerKiller = killer !== undefined && shooterId !== targetId;
    const killerTeam = isPlayerKiller ? killer.team : null;
    this.operations.push({
      kind: "player-killed",
      killerId: shooterId,
      victimId: targetId,
      source,
      killerTeam,
      teamKill: killerTeam !== null && killerTeam === target.team,
    });
  }

  damageCrate(crateId: string, damage: number): void {
    const crate = this.crates.get(crateId);
    if (!crate || crate.hp <= 0 || damage <= 0) return;

    crate.hp = Math.max(0, crate.hp - damage);
    this.operations.push({
      kind: "crate-damaged",
      crateId,
      damage,
      hp: crate.hp,
    });

    if (crate.hp > 0) return;
    this.crates.delete(crateId);
    this.operations.push({
      kind: "crate-destroyed",
      crateId,
      position: { ...crate.spec.position },
    });
    this.operations.push({
      kind: "pickup-drop-request",
      position: { x: crate.spec.position.x, y: 0.5, z: crate.spec.position.z },
    });
  }

  damageInteraction(interactionId: string, damage: number, ownerId: string): void {
    const queue: string[] = [];
    const damageOne = (targetId: string, amount: number): boolean => {
      const interaction = this.interactions.get(targetId);
      if (
        !interaction ||
        interaction.state.hp <= 0 ||
        !["tire-stack", "cover-panel", "explosive-barrel"].includes(interaction.spec.type) ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return false;
      }

      const wasSolid = interaction.state.hp > 0;
      interaction.state.hp = Math.max(0, interaction.state.hp - amount);
      if (interaction.state.hp === 0 && interaction.spec.type === "explosive-barrel") {
        interaction.state.active = 8;
      }
      this.operations.push({
        kind: "interactive-damaged",
        interactionId: targetId,
        damage: amount,
        destroyed: wasSolid && interaction.state.hp === 0,
      });
      return wasSolid && interaction.state.hp === 0 && interaction.spec.type === "explosive-barrel";
    };

    if (damageOne(interactionId, damage)) queue.push(interactionId);

    for (let index = 0; index < queue.length; index += 1) {
      const interaction = this.interactions.get(queue[index]);
      if (!interaction) continue;
      const center = {
        ...interaction.spec.position,
        y: interaction.spec.position.y + 0.5,
      };
      this.operations.push({
        kind: "world-blast",
        id: interaction.id,
        position: center,
      });

      const falloff = (position: Vec3): number =>
        Math.max(
          0,
          Math.round(
            80 -
              (80 *
                Math.hypot(
                  position.x - center.x,
                  position.y - center.y,
                  position.z - center.z
                )) /
                4
          )
        );

      for (const player of this.players.values()) {
        if (!player.position) continue;
        this.damagePlayer(ownerId, player.id, falloff(player.position), "barrel", center);
      }
      for (const crate of this.crates.values()) {
        this.damageCrate(crate.id, falloff(crateCenter(crate.spec)));
      }
      for (const other of this.interactions.values()) {
        if (damageOne(other.id, falloff(interactionCenter(other.spec)))) {
          queue.push(other.id);
        }
      }
    }
  }

  plan(): CombatResolutionPlan {
    return { operations: this.operations };
  }
}

export function resolveProjectileHit(
  world: CombatWorldView,
  request: ProjectileHitRequest
): CombatResolutionPlan {
  const state = new WorkingCombatState(world);
  switch (request.target.kind) {
    case "player":
      state.damagePlayer(
        request.ownerId,
        request.target.id,
        request.damage,
        request.weaponId,
        request.position
      );
      break;
    case "crate":
      state.damageCrate(request.target.id, request.damage);
      break;
    case "interactive":
      state.damageInteraction(request.target.id, request.damage, request.ownerId);
      break;
    default: {
      const unhandled: never = request.target;
      throw new Error(`Unhandled projectile target: ${String(unhandled)}`);
    }
  }
  return state.plan();
}

export function resolveRocketBlast(
  world: CombatWorldView,
  request: RocketBlastRequest
): CombatResolutionPlan {
  const state = new WorkingCombatState(world);
  state.operations.push({
    kind: "world-blast",
    id: `rocket-${request.projectileId}`,
    position: { ...request.position },
  });

  const damageAt = (position: Vec3): number =>
    rocketBlastDamage(
      Math.hypot(
        position.x - request.position.x,
        position.y - request.position.y,
        position.z - request.position.z
      )
    );

  for (const player of state.players.values()) {
    if (!player.position) continue;
    const damage = damageAt(player.position);
    if (
      damage > 0 &&
      !sweepProjectile(request.position, player.position, world.blockers)
    ) {
      state.damagePlayer(
        request.ownerId,
        player.id,
        damage,
        "rocket",
        request.position
      );
    }
  }
  for (const crate of state.crates.values()) {
    state.damageCrate(crate.id, damageAt(crateCenter(crate.spec)));
  }
  for (const interaction of state.interactions.values()) {
    state.damageInteraction(
      interaction.id,
      damageAt(interactionCenter(interaction.spec)),
      request.ownerId
    );
  }
  return state.plan();
}

export function resolveArcHit(
  world: CombatWorldView,
  request: ArcHitRequest
): CombatResolutionPlan {
  const state = new WorkingCombatState(world);
  const first = state.players.get(request.firstTargetId);
  if (!first?.position || first.status !== "alive") return state.plan();

  const points = [{ ...request.projectilePosition }, { ...first.position }];
  const visited = new Set([request.firstTargetId, request.ownerId]);
  let from = first.position;

  for (const damage of [20, 12]) {
    const candidates = [...state.players.values()]
      .filter(
        (player) =>
          player.status === "alive" &&
          player.position &&
          !visited.has(player.id)
      )
      .map((player) => ({
        player,
        distance: Math.hypot(
          player.position!.x - from.x,
          player.position!.y - from.y,
          player.position!.z - from.z
        ),
      }))
      .filter((candidate) => candidate.distance <= 4)
      .sort((a, b) => a.distance - b.distance);
    const target = candidates.find(
      ({ player }) =>
        player.position !== undefined &&
        !sweepProjectile(from, player.position, world.blockers)
    )?.player;
    if (!target?.position) break;

    visited.add(target.id);
    state.damagePlayer(
      request.ownerId,
      target.id,
      damage,
      request.weaponId,
      target.position
    );
    from = target.position;
    points.push({ ...from });
  }

  state.operations.push({ kind: "world-arc", points });
  state.damagePlayer(
    request.ownerId,
    request.firstTargetId,
    request.damage,
    request.weaponId,
    first.position
  );
  return state.plan();
}

export function resolveGrenadeExplosion(
  world: CombatWorldView,
  request: GrenadeExplosionRequest
): CombatResolutionPlan {
  const state = new WorkingCombatState(world);
  const hits: { targetId: string; damage: number }[] = [];
  const flashed: { targetId: string; intensity: number }[] = [];

  if (request.kind === "frag") {
    for (const player of state.players.values()) {
      if (!player.position || player.status !== "alive") continue;
      const damage = blastDamage(request.position, player.position);
      if (damage > 0) hits.push({ targetId: player.id, damage });
    }
    for (const crate of state.crates.values()) {
      const damage = blastDamage(request.position, crateCenter(crate.spec));
      if (damage > 0) hits.push({ targetId: crate.id, damage });
    }
  } else if (request.kind === "flash") {
    for (const player of state.players.values()) {
      if (!player.position || player.status !== "alive") continue;
      const intensity = flashIntensity(request.position, player.position);
      if (
        intensity > 0 &&
        !sweepProjectile(request.position, player.position, world.blockers)
      ) {
        flashed.push({ targetId: player.id, intensity });
      }
    }
  }

  if (request.kind === "smoke" || request.kind === "gas" || request.kind === "molotov") {
    state.operations.push({
      kind: "cloud-created",
      cloudId: `cloud-${request.grenadeId}`,
      cloudKind: request.kind === "molotov" ? "fire" : request.kind,
      ownerId: request.ownerId,
      position: { ...request.position },
    });
  }

  state.operations.push({
    kind: "grenade-exploded",
    grenadeId: request.grenadeId,
    grenadeKind: request.kind,
    ownerId: request.ownerId,
    position: { ...request.position },
    hits,
    flashed,
  });

  if (request.kind === "frag") {
    for (const interaction of state.interactions.values()) {
      state.damageInteraction(
        interaction.id,
        blastDamage(request.position, interactionCenter(interaction.spec)),
        request.ownerId
      );
    }
    for (const hit of hits) {
      if (state.players.has(hit.targetId)) {
        state.damagePlayer(
          request.ownerId,
          hit.targetId,
          hit.damage,
          "grenade",
          request.position
        );
      } else {
        state.damageCrate(hit.targetId, hit.damage);
      }
    }
  }
  return state.plan();
}

export function planChangesGeometry(plan: CombatResolutionPlan): boolean {
  return plan.operations.some(
    (operation) =>
      operation.kind === "crate-destroyed" ||
      (operation.kind === "interactive-damaged" &&
        operation.destroyed)
  );
}

function crateCenter(spec: CrateSpec): Vec3 {
  return aabbCenter(crateBox(spec));
}

function interactionCenter(spec: PropSpec): Vec3 {
  return { ...spec.position, y: spec.position.y + 0.5 };
}
