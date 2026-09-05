import { beforeEach, describe, expect, it } from "vitest";
import {
  GAME_EVENTS,
  PLAYER_MAX_HP,
  WEAPONS,
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
    room = new GameRoom(transport, { clock: () => now });
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
