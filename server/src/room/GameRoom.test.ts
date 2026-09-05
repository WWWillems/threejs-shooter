import { beforeEach, describe, expect, it } from "vitest";
import {
  CRATE_MAX_HP,
  GAME_EVENTS,
  GRENADE,
  PICKUP_LIFETIME,
  PLAYER_MAX_HP,
  WEAPONS,
  type PickupSpec,
  type WeaponId,
} from "@threejs-shooter/shared";
import { GameRoom } from "./GameRoom";
import { MemoryClient, MemoryTransport } from "../adapters/memory";

const DT = 1 / 20;

describe("GameRoom", () => {
  let transport: MemoryTransport;
  let room: GameRoom;
  let now: number;
  const client = (id: string) => new MemoryClient(id, room, transport);
  const origin = { x: 0, y: 1, z: 0 };

  /** Alice at the origin, Bob 10 units down -Z, both joined; outbox cleared. */
  const twoPlayers = () => {
    const alice = client("alice").connect();
    const bob = client("bob").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });
    bob.send(GAME_EVENTS.USER.JOINED, {
      name: "Bob",
      position: { x: 0, y: 1, z: -10 },
    });
    bob.send(GAME_EVENTS.PLAYER.POSITION, {
      position: { x: 0, y: 1, z: -10 },
      rotation: 0,
    });
    transport.clear();
    return { alice, bob };
  };

  const aliceShootsBob = (alice: MemoryClient, weaponType: WeaponId = "pistol") =>
    alice.send(GAME_EVENTS.WEAPON.SHOOT, {
      weaponType,
      action: "shoot",
      data: {
        position: { x: 0, y: 1, z: -0.6 },
        direction: { x: 0, y: 0, z: -1 },
      },
    });

  const runTicks = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += DT * 1000;
      room.tick(DT, now);
    }
  };

  beforeEach(() => {
    transport = new MemoryTransport();
    now = 10_000;
    room = new GameRoom(transport, { clock: () => now, seed: 1 });
  });

  describe("presence", () => {
    it("sends a late joiner the players already in the game", () => {
      const alice = client("alice").connect();
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });

      const bob = client("bob").connect();
      bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });

      const [state] = bob.received(GAME_EVENTS.GAME.STATE);
      expect(state.payload.selfId).toBe("bob");
      expect(state.payload.players.map((p) => p.name)).toEqual(["Alice"]);

      expect(alice.received(GAME_EVENTS.USER.JOINED)).toHaveLength(1);
      expect(bob.received(GAME_EVENTS.USER.JOINED)).toHaveLength(0);
    });

    it("ingests position updates and replicates them in the next snapshot", () => {
      const { alice, bob } = twoPlayers();

      const position = { x: 3, y: 1, z: -2 };
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position, rotation: 1.5 });
      runTicks(1);

      const [snapshot] = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snapshot.payload.players).toContainEqual(
        expect.objectContaining({ id: "alice", position, rotation: 1.5, hp: 100 })
      );
      expect(alice.received(GAME_EVENTS.WORLD.SNAPSHOT)).toHaveLength(1);
    });

    it("stamps each player's position with the time it was reported", () => {
      const { alice, bob } = twoPlayers();

      const reportedAt = now;
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: 1, y: 1, z: 0 },
        rotation: 0,
      });
      runTicks(3); // the report is repeated in three snapshots

      const snapshots = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snapshots).toHaveLength(3);
      for (const { payload } of snapshots) {
        const a = payload.players.find((p) => p.id === "alice")!;
        expect(a.positionAt).toBe(reportedAt);
        expect(payload.serverTime).toBeGreaterThan(reportedAt);
      }
    });

    it("numbers ticks monotonically", () => {
      const { alice } = twoPlayers();
      runTicks(3);
      const ticks = alice
        .received(GAME_EVENTS.WORLD.SNAPSHOT)
        .map((m) => m.payload.tick);
      expect(ticks).toEqual([1, 2, 3]);
    });

    it("removes a player on disconnect and tells the others", () => {
      const { alice, bob } = twoPlayers();
      alice.disconnect();

      expect(room.players.has("alice")).toBe(false);
      expect(room.leaderBoard.alice).toBeUndefined();
      expect(bob.received(GAME_EVENTS.USER.DISCONNECTED)).toHaveLength(1);
    });

    it("ignores intents from sockets that never joined", () => {
      const { bob } = twoPlayers();
      const ghost = client("ghost").connect();
      aliceShootsBob(ghost);

      expect(bob.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(0);
      expect(room.projectiles).toHaveLength(0);
    });
  });

  describe("combat", () => {
    it("a server bullet hits a player 10 units away and damages them", () => {
      const { alice, bob } = twoPlayers();
      aliceShootsBob(alice);

      // Cosmetic rebroadcast to others only
      expect(bob.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(1);
      expect(alice.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(0);

      // 10 units at 30 u/s = 1/3 s = ~7 ticks
      runTicks(10);

      const hits = bob.received(GAME_EVENTS.COMBAT.HIT);
      expect(hits).toHaveLength(1);
      expect(hits[0].payload).toMatchObject({
        shooterId: "alice",
        targetId: "bob",
        damage: WEAPONS.pistol.damage,
        hp: PLAYER_MAX_HP - WEAPONS.pistol.damage,
      });
      expect(room.players.get("bob")!.hp).toBe(75);
      expect(room.projectiles).toHaveLength(0);
    });

    it("never hits the shooter", () => {
      const { alice } = twoPlayers();
      // Shoot straight up from inside our own box
      alice.send(GAME_EVENTS.WEAPON.SHOOT, {
        weaponType: "pistol",
        action: "shoot",
        data: { position: origin, direction: { x: 0, y: 1, z: 0 } },
      });
      runTicks(5);
      expect(alice.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
    });

    it("a kill updates both leaderboard entries and marks the victim dead", () => {
      const { alice, bob } = twoPlayers();

      for (let shot = 0; shot < 4; shot++) {
        now += 1000; // respect the fire rate
        aliceShootsBob(alice);
        runTicks(10);
      }

      expect(room.players.get("bob")!.status).toBe("dead");
      expect(room.leaderBoard.alice).toMatchObject({ kills: 1, score: 100, deaths: 0 });
      expect(room.leaderBoard.bob).toMatchObject({ kills: 0, deaths: 1 });

      const kills = bob.received(GAME_EVENTS.COMBAT.KILL);
      expect(kills).toHaveLength(1);
      expect(kills[0].payload).toMatchObject({ killerId: "alice", victimId: "bob" });
    });

    it("drops shots that violate the fire rate", () => {
      const { alice, bob } = twoPlayers();
      aliceShootsBob(alice);
      now += 50; // pistol needs 400 ms
      aliceShootsBob(alice);

      expect(room.projectiles).toHaveLength(1);
      expect(bob.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(1);
    });

    it("spawns three pellets for a shotgun", () => {
      const { alice } = twoPlayers();
      aliceShootsBob(alice, "shotgun");
      expect(room.projectiles).toHaveLength(3);
    });

    it("dead players cannot shoot and do not block bullets", () => {
      const { alice, bob } = twoPlayers();
      for (let shot = 0; shot < 4; shot++) {
        now += 1000;
        aliceShootsBob(alice);
        runTicks(10);
      }
      transport.clear();

      aliceShootsBob(bob);
      expect(room.projectiles).toHaveLength(0);

      now += 1000;
      aliceShootsBob(alice);
      runTicks(10);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
    });

    it("hitboxes turn with the player", () => {
      const { alice, bob } = twoPlayers();
      // A grazing shot down -Z at x = 0.6: past the face of Bob's 1-wide box
      // when he faces straight ahead, inside it once he turns 45 degrees.
      const graze = () =>
        alice.send(GAME_EVENTS.WEAPON.SHOOT, {
          weaponType: "pistol",
          action: "shoot",
          data: {
            position: { x: 0.6, y: 1, z: -0.6 },
            direction: { x: 0, y: 0, z: -1 },
          },
        });

      graze();
      runTicks(10);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);

      bob.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: 0, y: 1, z: -10 },
        rotation: Math.PI / 4,
      });
      now += 1000;
      graze();
      runTicks(10);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(1);
    });

    it("bullets stop at world geometry", () => {
      const { alice } = twoPlayers();
      // Shoot at the shop (10x4x8 at z=-20): from z=-14 towards -Z
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: 0, y: 1, z: -14 },
        rotation: 0,
      });
      alice.send(GAME_EVENTS.WEAPON.SHOOT, {
        weaponType: "pistol",
        action: "shoot",
        data: {
          position: { x: 0, y: 1, z: -14.6 },
          direction: { x: 0, y: 0, z: -1 },
        },
      });
      runTicks(3);
      expect(room.projectiles).toHaveLength(0);
    });
  });

  describe("hazards", () => {
    it("standing in a car deals 20 damage per second, credited to the car", () => {
      const { alice, bob } = twoPlayers();
      const car = room.map.cars[1]; // (12, 0, 15)
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: car.position.x, y: 1, z: car.position.z },
        rotation: 0,
      });

      runTicks(20); // one second

      expect(room.players.get("alice")!.hp).toBe(80);
      const hits = bob.received(GAME_EVENTS.COMBAT.HIT);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].payload).toMatchObject({
        shooterId: car.id,
        targetId: "alice",
        source: "car",
      });
    });
  });

  describe("crates", () => {
    it("tells joiners which crates survive and with how much HP", () => {
      room.damageCrate("crate-0", 40);
      room.damageCrate("crate-1", CRATE_MAX_HP);

      const alice = client("alice").connect();
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });

      const [state] = alice.received(GAME_EVENTS.GAME.STATE);
      const ids = state.payload.crates.map((c) => c.id);
      expect(ids).toContain("crate-0");
      expect(ids).not.toContain("crate-1");
      expect(state.payload.crates.find((c) => c.id === "crate-0")!.hp).toBe(60);
    });

    it("server bullets damage crates and destroy them at zero HP", () => {
      const { alice, bob } = twoPlayers();
      // Pyramid crate on the +Z side, nothing between it and the shooter
      const crate = room.map.crates[2]; // (3.9, 0.5, 6.1), size 1
      const from = { x: crate.position.x, y: 0.5, z: crate.position.z + 5 };
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: from, rotation: 0 });

      for (let shot = 0; shot < 4; shot++) {
        now += 1000;
        alice.send(GAME_EVENTS.WEAPON.SHOOT, {
          weaponType: "pistol",
          action: "shoot",
          data: { position: from, direction: { x: 0, y: 0, z: -1 } },
        });
        runTicks(10);
      }

      const damaged = bob.received(GAME_EVENTS.CRATE.DAMAGED);
      expect(damaged).toHaveLength(4);
      expect(damaged[0].payload).toMatchObject({ crateId: crate.id, hp: 75 });
      expect(bob.received(GAME_EVENTS.CRATE.DESTROYED)).toHaveLength(1);
      expect(room.crates.has(crate.id)).toBe(false);

      // Destroyed crates no longer block bullets: the next shot flies through
      // to the crate behind it (crate-0 at z=3.9).
      transport.clear();
      now += 1000;
      alice.send(GAME_EVENTS.WEAPON.SHOOT, {
        weaponType: "pistol",
        action: "shoot",
        data: { position: from, direction: { x: 0, y: 0, z: -1 } },
      });
      runTicks(10);
      const next = bob.received(GAME_EVENTS.CRATE.DAMAGED);
      expect(next).toHaveLength(1);
      expect(next[0].payload.crateId).toBe("crate-0");
    });

    it("destroyed crates sometimes drop a pickup", () => {
      const { alice } = twoPlayers();
      for (const crate of room.map.crates) room.damageCrate(crate.id, CRATE_MAX_HP);

      const spawned = alice.received(GAME_EVENTS.PICKUP.SPAWNED);
      expect(spawned.length).toBeGreaterThan(0);
      expect(spawned.length).toBeLessThan(room.map.crates.length);
      expect(room.pickups.size).toBe(spawned.length);
    });
  });

  describe("pickups", () => {
    /** Destroy crates until one drops a pickup of `kind`; return its spec. */
    const dropPickup = (kind: PickupSpec["kind"]): PickupSpec => {
      for (const crate of room.map.crates) {
        room.damageCrate(crate.id, CRATE_MAX_HP);
        const found = [...room.pickups.values()].find((p) => p.spec.kind === kind);
        if (found) return found.spec;
      }
      throw new Error(`no ${kind} pickup dropped`);
    };

    it("spawns random pickups on a timer, away from players and geometry", () => {
      const { alice } = twoPlayers();
      runTicks(20 * 16); // > max spawn interval

      const spawned = alice.received(GAME_EVENTS.PICKUP.SPAWNED);
      expect(spawned.length).toBeGreaterThan(0);
      const position = spawned[0].payload.position;
      expect(Math.hypot(position.x, position.z)).toBeGreaterThanOrEqual(10);
    });

    it("a health pickup heals the claimant and everyone hears about it", () => {
      const { alice, bob } = twoPlayers();
      const pickup = dropPickup("health");
      aliceShootsBob(alice);
      runTicks(10);
      expect(room.players.get("bob")!.hp).toBe(75);
      transport.clear();

      bob.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { ...pickup.position, y: 1 },
        rotation: 0,
      });
      bob.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: pickup.id });

      const expectedHp = Math.min(PLAYER_MAX_HP, 75 + pickup.amount);
      expect(room.players.get("bob")!.hp).toBe(expectedHp);
      expect(room.pickups.has(pickup.id)).toBe(false);

      const [taken] = alice.received(GAME_EVENTS.PICKUP.TAKEN);
      expect(taken.payload).toMatchObject({ playerId: "bob", hp: expectedHp });
      expect(taken.payload.pickup.id).toBe(pickup.id);
    });

    it("rejects claims from out of reach and double claims", () => {
      const { alice, bob } = twoPlayers();
      const pickup = dropPickup("ammo");
      transport.clear();

      // Bob is 10 units away
      bob.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: pickup.id });
      expect(room.pickups.has(pickup.id)).toBe(true);
      expect(alice.received(GAME_EVENTS.PICKUP.TAKEN)).toHaveLength(0);

      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { ...pickup.position, y: 1 },
        rotation: 0,
      });
      bob.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { ...pickup.position, y: 1 },
        rotation: 0,
      });
      alice.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: pickup.id });
      bob.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: pickup.id });

      const taken = bob.received(GAME_EVENTS.PICKUP.TAKEN);
      expect(taken).toHaveLength(1);
      expect(taken[0].payload.playerId).toBe("alice");
      expect(taken[0].payload.hp).toBe(PLAYER_MAX_HP); // ammo leaves HP alone
    });

    it("pickups expire after their lifetime", () => {
      const { alice } = twoPlayers();
      const pickup = dropPickup("health");
      transport.clear();

      now += PICKUP_LIFETIME * 1000 + 1;
      runTicks(1);

      expect(room.pickups.has(pickup.id)).toBe(false);
      expect(alice.received(GAME_EVENTS.PICKUP.EXPIRED)).toContainEqual(
        expect.objectContaining({ payload: { pickupId: pickup.id } })
      );
    });
  });

  describe("grenades", () => {
    const fuseTicks = Math.ceil(GRENADE.fuse / DT) + 1;

    it("a thrown grenade is replicated in snapshots and explodes after its fuse", () => {
      const { alice, bob } = twoPlayers();
      // Lob towards Bob at (0, 1, -10)
      alice.send(GAME_EVENTS.GRENADE.THROW, {
        position: { x: 0, y: 1, z: -1 },
        direction: { x: 0, y: 0, z: -1 },
      });

      expect(room.grenades.size).toBe(1);
      expect(bob.received(GAME_EVENTS.GRENADE.THROW)).toHaveLength(1);
      expect(alice.received(GAME_EVENTS.GRENADE.THROW)).toHaveLength(0);

      runTicks(1);
      const [snap] = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snap.payload.grenades).toHaveLength(1);
      expect(snap.payload.grenades[0]).toMatchObject({ ownerId: "alice" });

      runTicks(fuseTicks);
      expect(room.grenades.size).toBe(0);

      const [exploded] = bob.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(exploded.payload.ownerId).toBe("alice");
      expect(exploded.payload.hits.map((h) => h.targetId)).toContain("bob");

      const hits = bob.received(GAME_EVENTS.COMBAT.HIT);
      expect(hits).toHaveLength(1);
      expect(hits[0].payload).toMatchObject({
        shooterId: "alice",
        targetId: "bob",
        source: "grenade",
      });
      expect(room.players.get("bob")!.hp).toBeLessThan(PLAYER_MAX_HP);
    });

    it("kills through the normal combat path", () => {
      const { alice, bob } = twoPlayers();
      // Drop grenades at Bob's feet from outside the blast radius
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: 0, y: 1, z: -2 },
        rotation: 0,
      });
      for (let n = 0; n < 2; n++) {
        now += GRENADE.throwCooldown * 1000 + 1;
        alice.send(GAME_EVENTS.GRENADE.THROW, {
          position: { x: 0, y: 0.5, z: -9.5 },
          direction: { x: 0, y: 0, z: -0.01 },
        });
        runTicks(fuseTicks);
      }

      expect(room.players.get("bob")!.status).toBe("dead");
      expect(room.leaderBoard.alice.kills).toBe(1);
      expect(bob.received(GAME_EVENTS.COMBAT.KILL)).toHaveLength(1);
      expect(bob.received(GAME_EVENTS.COMBAT.KILL)[0].payload).toMatchObject({
        killerId: "alice",
        victimId: "bob",
        source: "grenade",
      });
    });

    it("blast damage reaches crates", () => {
      const { alice } = twoPlayers();
      const crate = room.map.crates[0];
      alice.send(GAME_EVENTS.GRENADE.THROW, {
        position: { x: crate.position.x + 1.5, y: 0.5, z: crate.position.z + 1.5 },
        direction: { x: 0, y: -1, z: 0 },
      });
      runTicks(fuseTicks);

      const [exploded] = alice.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(exploded.payload.hits.map((h) => h.targetId)).toContain(crate.id);
      expect(alice.received(GAME_EVENTS.CRATE.DAMAGED).length).toBeGreaterThan(0);
    });

    it("enforces the throw cooldown and ignores dead throwers", () => {
      const { alice, bob } = twoPlayers();
      const throwIt = (who: MemoryClient) =>
        who.send(GAME_EVENTS.GRENADE.THROW, {
          position: origin,
          direction: { x: 0, y: 0, z: -1 },
        });

      throwIt(alice);
      throwIt(alice);
      expect(room.grenades.size).toBe(1);

      for (let shot = 0; shot < 4; shot++) {
        now += 1000;
        aliceShootsBob(alice);
        runTicks(10);
      }
      throwIt(bob);
      expect(room.grenades.size).toBe(1);
    });
  });

  describe("respawn", () => {
    it("only dead players can respawn, and everyone hears about it", () => {
      const { alice, bob } = twoPlayers();

      bob.send(GAME_EVENTS.PLAYER.RESPAWN, {});
      expect(alice.received(GAME_EVENTS.PLAYER.RESPAWN)).toHaveLength(0);

      for (let shot = 0; shot < 4; shot++) {
        now += 1000;
        aliceShootsBob(alice);
        runTicks(10);
      }
      transport.clear();

      bob.send(GAME_EVENTS.PLAYER.RESPAWN, {});

      const bobPlayer = room.players.get("bob")!;
      expect(bobPlayer.status).toBe("alive");
      expect(bobPlayer.hp).toBe(PLAYER_MAX_HP);

      const [event] = alice.received(GAME_EVENTS.PLAYER.RESPAWN);
      expect(event.payload.playerId).toBe("bob");
      expect(event.payload.position).toEqual(bobPlayer.position);
      expect(bob.received(GAME_EVENTS.PLAYER.RESPAWN)).toHaveLength(1);
    });
  });
});
