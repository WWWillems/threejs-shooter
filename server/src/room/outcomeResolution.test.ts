import { describe, expect, it } from "vitest";
import {
  aabbFromCenterSize,
  type Team,
  type Vec3,
} from "@threejs-shooter/shared";
import {
  resolveArcHit,
  resolveGrenadeExplosion,
  resolveProjectileHit,
  type CombatPlayerView,
  type CombatWorldView,
} from "./outcomeResolution";

function player(
  id: string,
  team: Team,
  position: Vec3,
  hp = 100
): CombatPlayerView {
  return { id, team, status: "alive", hp, position };
}

function world(players: CombatPlayerView[]): CombatWorldView {
  return {
    players,
    crates: [],
    interactions: [],
    blockers: [],
  };
}

describe("combat outcome resolution", () => {
  it("plans a hit and kill with friendly-fire attribution", () => {
    const plan = resolveProjectileHit(
      world([
        player("alice", "blue", { x: 0, y: 1, z: 0 }),
        player("bob", "blue", { x: 0, y: 1, z: 1 }),
      ]),
      {
        ownerId: "alice",
        weaponId: "pistol",
        position: { x: 0, y: 1, z: 0 },
        target: { kind: "player", id: "bob" },
        damage: 100,
      }
    );

    expect(plan.operations).toEqual([
      {
        kind: "player-damaged",
        armor: 0,
        shooterId: "alice",
        targetId: "bob",
        damage: 100,
        hp: 0,
        source: "pistol",
        position: { x: 0, y: 1, z: 0 },
      },
      {
        kind: "player-killed",
        killerId: "alice",
        victimId: "bob",
        source: "pistol",
        killerTeam: "blue",
        teamKill: true,
      },
    ]);
  });

  it("plans grenade event data before its frag damage operations", () => {
    const plan = resolveGrenadeExplosion(
      world([
        player("alice", "blue", { x: 0, y: 1, z: 0 }),
        player("bob", "red", { x: 0, y: 1, z: 2 }),
      ]),
      {
        grenadeId: "grenade-1",
        kind: "frag",
        ownerId: "alice",
        position: { x: 0, y: 1, z: 0 },
      }
    );

    expect(plan.operations[0]).toMatchObject({
      kind: "grenade-exploded",
      grenadeId: "grenade-1",
      hits: [{ targetId: "alice" }, { targetId: "bob" }],
    });
    expect(plan.operations.slice(1).map((operation) => operation.kind)).toEqual([
      "player-damaged",
      "player-damaged",
    ]);
  });

  it("keeps arc links behind solid geometry out of the plan", () => {
    const plan = resolveArcHit(
      {
        ...world([
          player("alice", "blue", { x: 0, y: 1, z: 0 }),
          player("bob", "red", { x: 0, y: 1, z: 2 }),
          player("charlie", "red", { x: 0, y: 1, z: 4 }),
        ]),
        blockers: [
          {
            box: aabbFromCenterSize(
              { x: 0, y: 1, z: 3 },
              { x: 2, y: 2, z: 0.2 }
            ),
            tag: { kind: "static", id: "wall" },
          },
        ],
      },
      {
        ownerId: "alice",
        weaponId: "arc",
        projectilePosition: { x: 0, y: 1, z: 0 },
        firstTargetId: "bob",
        damage: 32,
      }
    );

    expect(plan.operations.filter((operation) => operation.kind === "world-arc")[0]).toMatchObject({
      points: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 2 },
      ],
    });
    expect(
      plan.operations.filter(
        (operation): operation is Extract<typeof plan.operations[number], { kind: "player-damaged" }> =>
          operation.kind === "player-damaged"
      ).map((operation) => operation.targetId)
    ).toEqual(["bob"]);
  });
});


describe('armor absorption', () => {
  it.each([[15, 35, 100], [70, 0, 80], [160, 0, 0]])('absorbs a %i damage hit before health', (damage, armor, hp) => {
    const target = { ...player('bob', 'red', { x: 0, y: 1, z: 1 }), armor: 50 };
    const plan = resolveProjectileHit(world([target]), {
      ownerId: 'alice', weaponId: 'pistol', position: target.position!,
      target: { kind: 'player', id: 'bob' }, damage,
    });
    expect(plan.operations[0]).toMatchObject({ kind: 'player-damaged', hp, armor });
    expect(plan.operations.some(o => o.kind === 'player-killed')).toBe(hp === 0);
    expect(target.armor).toBe(50);
  });
});
