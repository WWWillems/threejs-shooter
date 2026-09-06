import { beforeEach, describe, expect, it } from "vitest";
import {
  CRATE_MAX_HP,
  GAME_EVENTS,
  GRENADE,
  GRENADE_EFFECTS,
  GRENADE_KINDS,
  GRENADE_LOADOUT,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  PICKUP_LIFETIME,
  PLAYER_MAX_HP,
  SHOP_SIZE,
  WEAPONS,
  aabbFromCenterSize,
  facingCenterYaw,
  generateMap,
  vec3,
  type CrateSpec,
  type GrenadeKind,
  type MapLayout,
  type MatchRules,
  type PickupSpec,
  type WeaponId,
} from "@threejs-shooter/shared";
import { GameRoom } from "./GameRoom";
import { MemoryClient, MemoryTransport } from "../adapters/memory";
import { loadServerLevel } from "../levelLoader";

const DT = 1 / 20;

/**
 * Rules for the mechanics tests: the round starts as soon as both teams are
 * present (two ticks: warmup -> countdown -> active) and never ends on its own.
 */
const OPEN_ENDED_RULES: MatchRules = {
  killLimit: 1_000,
  roundMs: 60 * 60_000,
  roundEndMs: 2_000,
  countdownMs: 0,
};

/** Short rules for the match pacing tests themselves. */
const SHORT_RULES: MatchRules = {
  killLimit: 2,
  roundMs: 60_000, // a kill down range takes ~6 s of simulated time

  roundEndMs: 2_000,
  countdownMs: 1_000,
};

/**
 * A small fixed world for the room tests, independent of the real level:
 * open ground around the origin, the shop 20 units down -Z, two cars, a
 * street light, three crates in an L at (3.9..6.1, 3.9..6.1) and a row of
 * ten more along z = 15 for the pickup-drop tests. Blue spawns at the origin
 * and on the west side, red on the east side and up +Z; the first player is
 * blue and lands on the origin.
 */
function testMap(): MapLayout {
  const half = 30;
  const wall = (id: string, center: [number, number], size: [number, number]) => ({
    id,
    box: aabbFromCenterSize(vec3(center[0], 1.25, center[1]), vec3(size[0], 2.5, size[1])),
  });
  const crate = (x: number, z: number, index: number): CrateSpec => ({
    id: `crate-${index}`,
    position: vec3(x, 0.5, z),
    size: 1,
    rotation: 0,
  });
  return {
    seed: 1,
    walls: [
      wall("wall-north", [0, half], [2 * half, 0.5]),
      wall("wall-south", [0, -half], [2 * half, 0.5]),
      wall("wall-east", [half, 0], [0.5, 2 * half]),
      wall("wall-west", [-half, 0], [0.5, 2 * half]),
    ],
    shop: { id: "shop", position: vec3(0, 0, -20), size: SHOP_SIZE },
    buildings: [],
    cars: [
      { id: "car-0", position: vec3(8, 0, 9), rotation: -Math.PI / 5, scale: 1, tiltZ: 0 },
      { id: "car-1", position: vec3(12, 0, 15), rotation: Math.PI / 3, scale: 1, tiltZ: 0 },
    ],
    streetLights: [{ id: "light-0", position: vec3(10, 0, 12), rotation: 0, scale: 1 }],
    crates: [
      crate(3.9, 3.9, 0),
      crate(6.1, 3.9, 1),
      crate(3.9, 6.1, 2),
      ...Array.from({ length: 10 }, (_, i) => crate(-12 + i * 1.2, 15, 3 + i)),
    ],
    cones: [],
    trees: [],
    bushes: [],
    props: [],
    spawnPoints: [
      { position: vec3(0, 1, 0), team: "blue" },
      { position: vec3(-12, 1, 0), team: "blue" },
      { position: vec3(12, 1, -4), team: "red" },
      { position: vec3(0, 1, 15), team: "red" },
    ],
  };
}

function interactiveTestMap(): MapLayout {
  return {
    ...testMap(),
    props: [
      { id: "tire-stack", type: "tire-stack", position: vec3(20, 0, 20), rotation: 0, scale: 1 },
      { id: "fire-barrel", type: "fire-barrel", position: vec3(22, 0, 20), rotation: 0, scale: 1 },
      { id: "warning-light", type: "warning-light", position: vec3(24, 0, 20), rotation: 0, scale: 1 },
      { id: "explosive-barrel", type: "explosive-barrel", position: vec3(20, 0, 24), rotation: 0, scale: 1 },
      { id: "smoke-zone", type: "smoke-zone", position: vec3(22, 0, 24), rotation: 0, scale: 1 },
      { id: "alarm-zone", type: "alarm-zone", position: vec3(24, 0, 24), rotation: 0, scale: 1 },
      { id: "cover-panel", type: "cover-panel", position: vec3(26, 0, 20), rotation: 0, scale: 1 },
      { id: "fence-gate", type: "fence-gate", position: vec3(26, 0, 24), rotation: 0, scale: 1 },
    ],
  };
}

describe("GameRoom", () => {
  let transport: MemoryTransport;
  let room: GameRoom;
  let now: number;
  const client = (id: string) => new MemoryClient(id, room, transport);
  const origin = { x: 0, y: 1, z: 0 };

  /**
   * Alice (blue) at the origin, Bob (red) 10 units down -Z, both joined and
   * the round active; outbox cleared.
   */
  const twoPlayers = () => {
    const alice = client("alice").connect();
    const bob = client("bob").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice" });
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob" });
    startRound();
    alice.send(GAME_EVENTS.PLAYER.POSITION, { position: origin, rotation: 0 });
    bob.send(GAME_EVENTS.PLAYER.POSITION, {
      position: { x: 0, y: 1, z: -10 },
      rotation: 0,
    });
    transport.clear();
    return { alice, bob };
  };

  /** `alice` kills whoever stands 10 units down -Z from the origin. */
  const killDownRange = (alice: MemoryClient) => {
    for (let shot = 0; shot < 4; shot++) {
      now += 1000; // respect the fire rate
      aliceShootsBob(alice);
      runTicks(10);
    }
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

  /** With both teams present and `OPEN_ENDED_RULES`, two ticks reach `active`. */
  const startRound = () => {
    runTicks(2);
    expect(room.match.phase).toBe("active");
  };

  it("constructs from the canonical serialized level", () => {
    const loadedRoom = new GameRoom(new MemoryTransport(), {
      map: loadServerLevel("default"),
    });

    // The checked-in JSON is the serialized generator output; regenerate it
    // (`npm run generate:default-level`) whenever `generateMap` changes.
    expect(loadedRoom.map).toEqual(generateMap());
    expect(loadedRoom.map.spawnPoints).toHaveLength(10);
    expect(loadedRoom.crates.size).toBe(loadedRoom.map.crates.length);
  });

  beforeEach(() => {
    transport = new MemoryTransport();
    now = 10_000;
    room = new GameRoom(transport, {
      clock: () => now,
      seed: 1,
      map: testMap(),
      matchRules: OPEN_ENDED_RULES,
    });
  });

  describe("presence", () => {
    it("sanitizes and bounds nicknames at the server join boundary", () => {
      const attacker = client("attacker").connect();

      attacker.send(GAME_EVENTS.USER.JOINED, {
        name: `<script>${"x".repeat(40)}</script>`,
      });

      const player = room.players.get("attacker");
      expect(player).toBeDefined();
      expect(player?.name).toBe("scriptxxxxxxxxxxxxxxxxxx");
      expect(Array.from(player?.name ?? "")).toHaveLength(24);
      expect(room.leaderBoard.attacker.name).toBe(player?.name);
    });

    it("sends a late joiner the players already in the game, themselves included", () => {
      const alice = client("alice").connect();
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice" });

      const bob = client("bob").connect();
      bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob" });

      const [state] = bob.received(GAME_EVENTS.GAME.STATE);
      expect(state.payload.selfId).toBe("bob");
      expect(state.payload.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
      const self = state.payload.players.find((p) => p.id === "bob")!;
      expect(self.team).toBe("red");
      expect(self.position).toEqual(room.players.get("bob")!.position);

      const [joined] = alice.received(GAME_EVENTS.USER.JOINED);
      expect(joined.payload).toMatchObject({
        id: "bob",
        name: "Bob",
        team: "red",
        position: self.position,
      });
      expect(bob.received(GAME_EVENTS.USER.JOINED)).toHaveLength(0);
    });
  });

  describe("teams", () => {
    const joinMany = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const c = client(`p${i}`).connect();
        c.send(GAME_EVENTS.USER.JOINED, { name: `P${i}` });
        return c;
      });

    it("assigns joiners to the smaller team, blue first", () => {
      joinMany(5);
      const teams = Array.from({ length: 5 }, (_, i) => room.players.get(`p${i}`)!.team);
      expect(teams).toEqual(["blue", "red", "blue", "red", "blue"]);
      expect(room.teamCounts()).toEqual({ blue: 3, red: 2 });
      expect(room.leaderBoard.p0.team).toBe("blue");
    });

    it("tops up the team that lost a player", () => {
      const players = joinMany(4); // blue, red, blue, red
      players[0].disconnect();
      players[2].disconnect(); // blue is now empty
      const late = client("late").connect();
      late.send(GAME_EVENTS.USER.JOINED, { name: "Late" });
      expect(room.players.get("late")!.team).toBe("blue");
    });

    it("rejects the eleventh player without registering them", () => {
      joinMany(MAX_PLAYERS);
      expect(room.teamCounts()).toEqual({ blue: MAX_TEAM_SIZE, red: MAX_TEAM_SIZE });

      const extra = client("extra").connect();
      extra.send(GAME_EVENTS.USER.JOINED, { name: "Extra" });

      expect(room.players.has("extra")).toBe(false);
      expect(room.leaderBoard.extra).toBeUndefined();
      expect(extra.received(GAME_EVENTS.USER.JOIN_REJECTED)).toHaveLength(1);
      expect(extra.received(GAME_EVENTS.USER.JOIN_REJECTED)[0].payload.reason).toBe(
        "room-full"
      );
      expect(extra.received(GAME_EVENTS.GAME.STATE)).toHaveLength(0);
      // Nobody else heard about them
      expect(
        transport
          .received("p0", GAME_EVENTS.USER.JOINED)
          .filter((m) => m.payload.id === "extra")
      ).toHaveLength(0);

      // A slot frees up and the next join goes through
      room.leave("p0");
      const next = client("next").connect();
      next.send(GAME_EVENTS.USER.JOINED, { name: "Next" });
      expect(room.players.get("next")!.team).toBe("blue");
    });

    it("spawns and respawns each player inside their own team's zone", () => {
      const zoneOf = (p: { x: number; z: number }) =>
        room.map.spawnPoints.find((s) => s.position.x === p.x && s.position.z === p.z)?.team;

      const alice = client("alice").connect();
      const bob = client("bob").connect();
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice" });
      bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob" });

      // Initial spawns are server-picked, one per zone
      expect(zoneOf(room.players.get("alice")!.position!)).toBe("blue");
      expect(zoneOf(room.players.get("bob")!.position!)).toBe("red");

      // Bob walks down range, dies, and comes back on the red side
      startRound();
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: origin, rotation: 0 });
      bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: -10 }, rotation: 0 });
      killDownRange(alice);
      transport.clear();
      bob.send(GAME_EVENTS.PLAYER.RESPAWN, {});
      const [respawn] = alice.received(GAME_EVENTS.PLAYER.RESPAWN);
      expect(zoneOf(respawn.payload.position)).toBe("red");
    });

    it("an enemy kill scores for the killer's team", () => {
      const { alice } = twoPlayers();
      killDownRange(alice);
      expect(room.teamScores).toEqual({ blue: 1, red: 0 });
      expect(room.leaderboardResponse()).toEqual({
        players: room.leaderBoard,
        teams: { blue: 1, red: 0 },
        match: { phase: "active", phaseEndsAt: room.match.phaseEndsAt, teamScores: { blue: 1, red: 0 } },
      });
    });

    it("a team kill costs the killer and their team a kill, and still counts the victim's death", () => {
      const { alice, bob } = twoPlayers();
      // Carol is blue like Alice; stand her where Bob was and move Bob away.
      const carol = client("carol").connect();
      carol.send(GAME_EVENTS.USER.JOINED, { name: "Carol" });
      expect(room.players.get("carol")!.team).toBe("blue");
      carol.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: -10 }, rotation: 0 });
      bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 10, y: 1, z: 10 }, rotation: 0 });
      transport.clear();

      killDownRange(alice);

      expect(room.players.get("carol")!.status).toBe("dead");
      expect(room.leaderBoard.alice).toMatchObject({ kills: -1, score: -100, deaths: 0 });
      expect(room.leaderBoard.carol).toMatchObject({ kills: 0, deaths: 1 });
      expect(room.teamScores).toEqual({ blue: -1, red: 0 });

      const [kill] = bob.received(GAME_EVENTS.COMBAT.KILL);
      expect(kill.payload).toMatchObject({
        killerId: "alice",
        victimId: "carol",
        teamKill: true,
        teamScores: { blue: -1, red: 0 },
      });
    });

    it("keeps a leaver's kills on the team score", () => {
      const { alice } = twoPlayers();
      killDownRange(alice);
      alice.disconnect();
      expect(room.leaderBoard.alice).toBeUndefined();
      expect(room.teamScores).toEqual({ blue: 1, red: 0 });
    });

    it("does not score world hazards for any team", () => {
      const { alice } = twoPlayers();
      const car = room.map.cars[1];
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: car.position.x, y: 1, z: car.position.z },
        rotation: 0,
      });
      runTicks(20 * 6); // well past 100 damage
      expect(room.players.get("alice")!.status).toBe("dead");
      expect(room.teamScores).toEqual({ blue: 0, red: 0 });
      const [kill] = alice.received(GAME_EVENTS.COMBAT.KILL);
      expect(kill.payload.teamKill).toBe(false);
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

    it("replicates bounded cosmetic pose without changing health or position", () => {
      const { alice, bob } = twoPlayers();
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: origin, rotation: .4,
        pose: { crouched: true, grounded: false, reload: 7 } });
      runTicks(1);
      const [snapshot] = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snapshot.payload.players.find(p => p.id === "alice")).toMatchObject({
        position: origin, hp: 100, pose: { crouched: true, grounded: false, reload: 1 },
      });
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
      expect(ticks).toEqual([ticks[0], ticks[0] + 1, ticks[0] + 2]);
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

  describe("chat", () => {
    it("broadcasts a canonical message to every joined player", () => {
      const { alice, bob } = twoPlayers();

      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "  Hello, world!  " });

      const aliceMessages = alice.received(GAME_EVENTS.CHAT.MESSAGE);
      const bobMessages = bob.received(GAME_EVENTS.CHAT.MESSAGE);
      expect(aliceMessages).toHaveLength(1);
      expect(bobMessages).toHaveLength(1);
      expect(bobMessages[0].payload).toMatchObject({
        senderId: "alice",
        senderName: "Alice",
        text: "Hello, world!",
        serverTime: now,
      });
      expect(bobMessages[0].payload.messageId).toBe("alice-1");
    });

    it("rejects unjoined, dead, invalid, and rate-limited messages", () => {
      const attacker = client("attacker").connect();
      attacker.send(GAME_EVENTS.CHAT.MESSAGE, { text: "not joined" });
      expect(attacker.received(GAME_EVENTS.CHAT.MESSAGE)).toHaveLength(0);

      const { alice } = twoPlayers();
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "" });
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: " \t\n " });
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "line\u0000break" });
      expect(alice.received(GAME_EVENTS.CHAT.MESSAGE)).toHaveLength(0);

      room.players.get("alice")!.status = "dead";
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "dead chat" });
      expect(alice.received(GAME_EVENTS.CHAT.MESSAGE)).toHaveLength(0);

      room.players.get("alice")!.status = "alive";
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "first" });
      now += 499;
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "too soon" });
      expect(alice.received(GAME_EVENTS.CHAT.MESSAGE)).toHaveLength(1);

      now += 1;
      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "second" });
      expect(alice.received(GAME_EVENTS.CHAT.MESSAGE)).toHaveLength(2);
    });

    it("bounds accepted messages by Unicode code points", () => {
      const { alice } = twoPlayers();

      alice.send(GAME_EVENTS.CHAT.MESSAGE, { text: "😀".repeat(200) });

      const [message] = alice.received(GAME_EVENTS.CHAT.MESSAGE);
      expect(Array.from(message.payload.text)).toHaveLength(128);
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
      killDownRange(alice);

      expect(room.players.get("bob")!.status).toBe("dead");
      expect(room.leaderBoard.alice).toMatchObject({ kills: 1, score: 100, deaths: 0 });
      expect(room.leaderBoard.bob).toMatchObject({ kills: 0, deaths: 1 });

      const kills = bob.received(GAME_EVENTS.COMBAT.KILL);
      expect(kills).toHaveLength(1);
      expect(kills[0].payload).toMatchObject({
        killerId: "alice",
        victimId: "bob",
        teamKill: false,
        teamScores: { blue: 1, red: 0 },
      });
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
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice" });

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

    it("crates drop throwables, which the claimant is told about like ammo", () => {
      const { alice, bob } = twoPlayers();
      const pickup = dropPickup("throwable");
      expect(pickup.kind).toBe("throwable");
      if (pickup.kind !== "throwable") return;
      expect(GRENADE_KINDS).toContain(pickup.grenadeKind);
      expect(pickup.amount).toBe(GRENADE_LOADOUT[pickup.grenadeKind].pickup);
      transport.clear();

      bob.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { ...pickup.position, y: 1 },
        rotation: 0,
      });
      bob.send(GAME_EVENTS.PICKUP.CLAIM, { pickupId: pickup.id });

      expect(room.pickups.has(pickup.id)).toBe(false);
      const [taken] = alice.received(GAME_EVENTS.PICKUP.TAKEN);
      expect(taken.payload).toMatchObject({ playerId: "bob", pickup });
      // Counts are client-trusted: the server changes nothing else.
      expect(room.players.get("bob")!.hp).toBe(PLAYER_MAX_HP);
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
        kind: "frag",
        position: { x: 0, y: 1, z: -1 },
        direction: { x: 0, y: 0, z: -1 },
      });

      expect(room.grenades.size).toBe(1);
      expect(bob.received(GAME_EVENTS.GRENADE.THROW)).toHaveLength(1);
      expect(alice.received(GAME_EVENTS.GRENADE.THROW)).toHaveLength(0);

      runTicks(1);
      const [snap] = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snap.payload.grenades).toHaveLength(1);
      expect(snap.payload.grenades[0]).toMatchObject({ ownerId: "alice", kind: "frag" });

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
      // Drop grenades straight down at Bob's feet, from outside the blast radius
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: 0, y: 1, z: -2 },
        rotation: 0,
      });
      for (let n = 0; n < 2; n++) {
        now += GRENADE.throwCooldown * 1000 + 1;
        alice.send(GAME_EVENTS.GRENADE.THROW, {
          kind: "frag",
          position: { x: 0, y: 0.5, z: -9.5 },
          direction: { x: 0, y: -1, z: 0 },
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
        kind: "frag",
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
          kind: "frag",
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

    it("drops throws of an unknown kind", () => {
      const { alice } = twoPlayers();
      alice.send(GAME_EVENTS.GRENADE.THROW, {
        kind: "nuke" as unknown as GrenadeKind,
        position: origin,
        direction: { x: 0, y: 0, z: -1 },
      });
      expect(room.grenades.size).toBe(0);
    });

    /** Drop a `kind` grenade straight down at `at`; it lands and detonates there. */
    const detonate = (who: MemoryClient, kind: GrenadeKind, at: { x: number; z: number }) => {
      now += GRENADE.throwCooldown * 1000 + 1;
      who.send(GAME_EVENTS.GRENADE.THROW, {
        kind,
        position: { x: at.x, y: 0.5, z: at.z },
        direction: { x: 0, y: -1, z: 0 },
      });
      runTicks(fuseTicks);
    };

    it("a smoke grenade hurts nobody and leaves a cloud that fades out of the snapshots", () => {
      const { alice, bob } = twoPlayers();
      detonate(alice, "smoke", { x: 0, z: -10 });

      const [exploded] = bob.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(exploded.payload).toMatchObject({ kind: "smoke", hits: [], flashed: [] });
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
      expect(room.players.get("bob")!.hp).toBe(PLAYER_MAX_HP);

      expect(room.clouds.size).toBe(1);
      const snapshots = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
      const latest = snapshots[snapshots.length - 1].payload;
      expect(latest.clouds).toHaveLength(1);
      expect(latest.clouds[0]).toMatchObject({
        kind: "smoke",
        position: { x: 0, y: 0, z: -10 },
      });
      expect(latest.clouds[0].remaining).toBeGreaterThan(0);
      expect(latest.clouds[0].remaining).toBeLessThanOrEqual(GRENADE_EFFECTS.smoke.duration);

      runTicks(Math.ceil(GRENADE_EFFECTS.smoke.duration / DT) + 1);
      expect(room.clouds.size).toBe(0);
      expect(room.players.get("bob")!.hp).toBe(PLAYER_MAX_HP);
    });

    it("a gas cloud poisons whoever stands in it, crediting the thrower, and stops when they leave", () => {
      const { alice, bob } = twoPlayers();
      detonate(alice, "gas", { x: 0, z: -10 });
      expect(room.clouds.size).toBe(1);
      transport.clear();

      runTicks(20); // one second inside
      const hits = bob.received(GAME_EVENTS.COMBAT.HIT);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].payload).toMatchObject({ shooterId: "alice", targetId: "bob", source: "gas" });
      const dealt = hits.reduce((sum, h) => sum + h.payload.damage, 0);
      expect(dealt).toBeGreaterThanOrEqual(GRENADE_EFFECTS.gas.dps - 1);
      expect(dealt).toBeLessThanOrEqual(GRENADE_EFFECTS.gas.dps + 1);
      // Alice, at the origin, is well outside the cloud.
      expect(room.players.get("alice")!.hp).toBe(PLAYER_MAX_HP);

      // Bob steps out; the poison stops.
      bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: -20 }, rotation: 0 });
      transport.clear();
      runTicks(20);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
    });

    it("gas kills go through the normal combat path", () => {
      const { alice, bob } = twoPlayers();
      detonate(alice, "gas", { x: 0, z: -10 });
      runTicks(Math.ceil(GRENADE_EFFECTS.gas.duration / DT));
      // 8 s at 12 dps is 96 damage: one more cloud finishes the job.
      detonate(alice, "gas", { x: 0, z: -10 });
      runTicks(20);

      expect(room.players.get("bob")!.status).toBe("dead");
      expect(room.leaderBoard.alice.kills).toBe(1);
      expect(bob.received(GAME_EVENTS.COMBAT.KILL)[0].payload).toMatchObject({
        killerId: "alice",
        victimId: "bob",
        source: "gas",
      });
    });

    it("a flashbang blinds everyone in sight, harder up close, and not through walls", () => {
      const { alice, bob } = twoPlayers();
      // Bob at (0, 1, -10); Alice at the origin. Detonate 2 units from Bob.
      detonate(alice, "flash", { x: 0, z: -8 });

      const [exploded] = bob.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(exploded.payload.kind).toBe("flash");
      expect(exploded.payload.hits).toEqual([]);
      const byId = new Map(exploded.payload.flashed.map((f) => [f.targetId, f.intensity]));
      expect(byId.get("bob")).toBeGreaterThan(byId.get("alice")!);
      expect(byId.get("bob")).toBeGreaterThan(0.7);
      expect(byId.get("alice")).toBeGreaterThan(0);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
      expect(room.players.get("bob")!.hp).toBe(PLAYER_MAX_HP);

      // Same 2-unit distance, but with the north wall (z = 30) in between.
      bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: 31 }, rotation: 0 });
      transport.clear();
      detonate(alice, "flash", { x: 0, z: 29 });
      const [behind] = bob.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(behind.payload.flashed.map((f) => f.targetId)).not.toContain("bob");
    });

    it("a molotov shatters where it first lands, long before its fuse, and leaves a fire", () => {
      const { alice, bob } = twoPlayers();
      now += GRENADE.throwCooldown * 1000 + 1;
      alice.send(GAME_EVENTS.GRENADE.THROW, {
        kind: "molotov",
        position: { x: 0, y: 0.5, z: -8 },
        direction: { x: 0, y: -1, z: 0 },
      });
      // Dropped from half a unit up it hits the ground within a few ticks.
      runTicks(5);
      expect(room.grenades.size).toBe(0);

      const [exploded] = bob.received(GAME_EVENTS.GRENADE.EXPLODED);
      expect(exploded.payload).toMatchObject({ kind: "molotov", hits: [], flashed: [] });
      expect(exploded.payload.position.z).toBeCloseTo(-8, 0);
      expect(room.clouds.size).toBe(1);
      const [fire] = room.clouds.values();
      expect(fire).toMatchObject({ kind: "fire", ownerId: "alice", position: { y: 0 } });
      expect(fire.remaining).toBeGreaterThan(GRENADE_EFFECTS.molotov.duration - 5 * DT - 1e-9);
    });

    it("fire burns whoever stands in it fast, crediting the thrower with source fire", () => {
      const { alice, bob } = twoPlayers();
      detonate(alice, "molotov", { x: 0, z: -10 });
      transport.clear();

      runTicks(20); // one second in the flames
      const hits = bob.received(GAME_EVENTS.COMBAT.HIT);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].payload).toMatchObject({ shooterId: "alice", targetId: "bob", source: "fire" });
      const dealt = hits.reduce((sum, h) => sum + h.payload.damage, 0);
      expect(dealt).toBeGreaterThanOrEqual(GRENADE_EFFECTS.molotov.dps - 1);
      expect(dealt).toBeLessThanOrEqual(GRENADE_EFFECTS.molotov.dps + 1);

      // Standing in it for the whole burn is lethal; the kill carries the fire source.
      runTicks(Math.ceil(GRENADE_EFFECTS.molotov.duration / DT));
      expect(room.players.get("bob")!.status).toBe("dead");
      expect(bob.received(GAME_EVENTS.COMBAT.KILL)[0].payload).toMatchObject({
        killerId: "alice",
        victimId: "bob",
        source: "fire",
      });
      expect(room.clouds.size).toBe(0);
    });

    it("overlapping gas and fire do not stack; the fire's rate applies", () => {
      const { alice, bob } = twoPlayers();
      detonate(alice, "gas", { x: 0, z: -10 });
      detonate(alice, "molotov", { x: 0, z: -10 });
      transport.clear();

      runTicks(20);
      const dealt = bob
        .received(GAME_EVENTS.COMBAT.HIT)
        .reduce((sum, h) => sum + h.payload.damage, 0);
      expect(dealt).toBeLessThanOrEqual(GRENADE_EFFECTS.molotov.dps + 1);
      expect(dealt).toBeGreaterThanOrEqual(GRENADE_EFFECTS.molotov.dps - 1);
    });

    it("a round reset clears lingering clouds", () => {
      room = new GameRoom(transport, { clock: () => now, seed: 1, map: testMap(), matchRules: SHORT_RULES });
      const alice = client("alice").connect();
      const bob = client("bob").connect();
      alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice" });
      bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob" });
      runTicks(1); // warmup -> countdown
      runTicks(SHORT_RULES.countdownMs / (DT * 1000)); // countdown -> active
      expect(room.match.phase).toBe("active");

      detonate(alice, "gas", { x: 0, z: -10 });
      expect(room.clouds.size).toBe(1);

      now += SHORT_RULES.roundMs;
      runTicks(1); // active -> round-end
      now += SHORT_RULES.roundEndMs;
      runTicks(1); // round-end -> countdown, with the world reset
      expect(room.clouds.size).toBe(0);
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
      expect(event.payload.rotation).toBeCloseTo(facingCenterYaw(event.payload.position));
      expect(bob.received(GAME_EVENTS.PLAYER.RESPAWN)).toHaveLength(1);
    });
  });

  describe("match pacing", () => {
    const zoneOf = (p: { x: number; z: number }) =>
      room.map.spawnPoints.find((s) => s.position.x === p.x && s.position.z === p.z)?.team;

    beforeEach(() => {
      room = new GameRoom(transport, {
        clock: () => now,
        seed: 1,
        map: testMap(),
        matchRules: SHORT_RULES,
      });
    });

    const join = (id: string) => {
      const c = client(id).connect();
      c.send(GAME_EVENTS.USER.JOINED, { name: id });
      return c;
    };

    /** Alice and Bob joined, the countdown run out, both in position; outbox cleared. */
    const activeRound = () => {
      const alice = join("alice");
      const bob = join("bob");
      runTicks(1); // warmup -> countdown
      runTicks(SHORT_RULES.countdownMs / (DT * 1000)); // countdown -> active
      expect(room.match.phase).toBe("active");
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: origin, rotation: 0 });
      bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: -10 }, rotation: 0 });
      transport.clear();
      return { alice, bob };
    };

    /** Bob dies `times` times at the hands of Alice, respawning in between. */
    const killBob = (alice: MemoryClient, bob: MemoryClient, times: number) => {
      for (let n = 0; n < times; n++) {
        killDownRange(alice);
        if (n < times - 1) {
          bob.send(GAME_EVENTS.PLAYER.RESPAWN, {});
          bob.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 0, y: 1, z: -10 }, rotation: 0 });
        }
      }
    };

    it("waits in warmup until both teams have a player", () => {
      const alice = join("alice");
      runTicks(5);

      expect(room.match.phase).toBe("warmup");
      expect(alice.received(GAME_EVENTS.MATCH.PHASE)).toHaveLength(0);
      const [snapshot] = alice.received(GAME_EVENTS.WORLD.SNAPSHOT);
      expect(snapshot.payload.match).toEqual({
        phase: "warmup",
        phaseEndsAt: null,
        teamScores: { blue: 0, red: 0 },
      });
      const [state] = alice.received(GAME_EVENTS.GAME.STATE);
      expect(state.payload.match).toMatchObject({ phase: "warmup", result: null });

      join("bob");
      transport.clear();
      runTicks(1);

      expect(room.match.phase).toBe("countdown");
      const [phase] = alice.received(GAME_EVENTS.MATCH.PHASE);
      expect(phase.payload).toEqual({
        phase: "countdown",
        phaseEndsAt: now + SHORT_RULES.countdownMs,
        teamScores: { blue: 0, red: 0 },
      });
    });

    it("resets the world into the countdown and full-syncs every player", () => {
      room = new GameRoom(transport, {
        clock: () => now,
        seed: 1,
        map: interactiveTestMap(),
        matchRules: SHORT_RULES,
      });
      const alice = join("alice");
      // Warmup leaves its marks: a broken crate, a moved player, some score.
      room.damageCrate("crate-0", CRATE_MAX_HP);
      room.interactions.damage("tire-stack", 120);
      room.interactions.damage("explosive-barrel", 45);
      room.interactions.damage("cover-panel", 80);
      room.interactions.interact("smoke-zone", {
        status: "alive",
        position: { x: 22, y: 1, z: 24 },
      }, []);
      room.interactions.tick(.1, [{
        status: "alive",
        position: { x: 24, y: 1, z: 24 },
      }]);
      room.interactions.interact("fence-gate", {
        status: "alive",
        position: { x: 26, y: 1, z: 24 },
      }, []);
      room.interactions.tick(1, []);
      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 5, y: 1, z: 5 }, rotation: 1 });
      room.teamScores.blue = 3;
      room.leaderBoard.alice.kills = 3;
      room.leaderBoard.alice.score = 300;
      room.leaderBoard.alice.deaths = 2;
      const bob = join("bob");
      transport.clear();

      runTicks(1);

      expect(room.crates.size).toBe(room.map.crates.length);
      expect(room.pickups.size).toBe(0);
      expect(room.interactions.snapshot()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "tire-stack", hp: 120, open: 0, targetOpen: false, active: 0, cooldown: 0 }),
        expect.objectContaining({ id: "explosive-barrel", hp: 45, active: 0 }),
        expect.objectContaining({ id: "cover-panel", hp: 80 }),
        expect.objectContaining({ id: "smoke-zone", active: 0, cooldown: 0 }),
        expect.objectContaining({ id: "alarm-zone", active: 0, cooldown: 0 }),
        expect.objectContaining({ id: "fence-gate", open: 0, targetOpen: false }),
      ]));
      expect(room.teamScores).toEqual({ blue: 0, red: 0 });
      expect(room.leaderBoard.alice).toMatchObject({ kills: 0, deaths: 0, score: 0, name: "alice" });
      expect(zoneOf(room.players.get("alice")!.position!)).toBe("blue");
      expect(room.players.get("alice")!.rotation).not.toBe(1);

      for (const [who, id] of [[alice, "alice"], [bob, "bob"]] as const) {
        const states = who.received(GAME_EVENTS.GAME.STATE);
        expect(states).toHaveLength(1);
        expect(states[0].payload.selfId).toBe(id);
        expect(states[0].payload.crates).toHaveLength(room.map.crates.length);
        expect(states[0].payload.pickups).toEqual([]);
        expect(states[0].payload.interactions).toEqual(room.interactions.snapshot());
        expect(states[0].payload.match).toMatchObject({ phase: "countdown", result: null });
        for (const p of states[0].payload.players) {
          expect(p).toMatchObject({ status: "alive", hp: PLAYER_MAX_HP });
        }
        expect(who.received(GAME_EVENTS.MATCH.PHASE)).toHaveLength(1);
      }
    });

    it("freezes everyone during the countdown and lets them go when the round starts", () => {
      const alice = join("alice");
      join("bob");
      runTicks(1);
      transport.clear();
      const spawn = { ...room.players.get("alice")!.position! };

      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 3, y: 1, z: 3 }, rotation: 0 });
      aliceShootsBob(alice);
      expect(room.players.get("alice")!.position).toEqual(spawn);
      expect(room.projectiles).toHaveLength(0);

      runTicks(SHORT_RULES.countdownMs / (DT * 1000));
      expect(room.match.phase).toBe("active");
      const [phase] = alice.received(GAME_EVENTS.MATCH.PHASE);
      expect(phase.payload).toMatchObject({
        phase: "active",
        phaseEndsAt: now + SHORT_RULES.roundMs,
      });
      expect(alice.received(GAME_EVENTS.GAME.STATE)).toHaveLength(0); // no reset on GO

      alice.send(GAME_EVENTS.PLAYER.POSITION, { position: { x: 3, y: 1, z: 3 }, rotation: 0 });
      expect(room.players.get("alice")!.position).toEqual({ x: 3, y: 1, z: 3 });
    });

    it("ends the round at the kill limit and publishes the result", () => {
      const { alice, bob } = activeRound();

      killBob(alice, bob, SHORT_RULES.killLimit);

      expect(room.match.phase).toBe("round-end");
      expect(room.teamScores).toEqual({ blue: 2, red: 0 });
      const ended = bob
        .received(GAME_EVENTS.MATCH.PHASE)
        .find((m) => m.payload.phase === "round-end")!;
      expect(ended.payload.result).toMatchObject({
        winner: "blue",
        teamScores: { blue: 2, red: 0 },
      });
      expect(ended.payload.result!.leaderboard).toContainEqual(
        expect.objectContaining({ id: "alice", kills: 2, score: 200 })
      );
      expect(ended.payload.result!.leaderboard).toContainEqual(
        expect.objectContaining({ id: "bob", deaths: 2 })
      );
      expect(ended.payload.phaseEndsAt).toBe(room.match.phaseEndsAt);
    });

    it("ends the round on the clock, the leader winning and a tie a draw", () => {
      const { alice, bob } = activeRound();
      killBob(alice, bob, 1);
      now += SHORT_RULES.roundMs;
      runTicks(1);
      expect(room.match.phase).toBe("round-end");
      expect(room.match.result?.winner).toBe("blue");

      // A fresh room, nobody scores, the clock runs out
      transport = new MemoryTransport();
      room = new GameRoom(transport, { clock: () => now, seed: 1, map: testMap(), matchRules: SHORT_RULES });
      activeRound();
      now += SHORT_RULES.roundMs;
      runTicks(1);
      expect(room.match.result?.winner).toBe("draw");
    });

    it("turns combat off during the results but lets players move", () => {
      const { alice, bob } = activeRound();
      now += SHORT_RULES.roundMs;
      runTicks(1);
      transport.clear();

      aliceShootsBob(alice);
      alice.send(GAME_EVENTS.GRENADE.THROW, { kind: "frag", position: origin, direction: { x: 0, y: 0, z: -1 } });
      expect(room.projectiles).toHaveLength(0);
      expect(room.grenades.size).toBe(0);
      expect(bob.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(0);

      const car = room.map.cars[1];
      alice.send(GAME_EVENTS.PLAYER.POSITION, {
        position: { x: car.position.x, y: 1, z: car.position.z },
        rotation: 0,
      });
      expect(room.players.get("alice")!.position).toEqual({ x: car.position.x, y: 1, z: car.position.z });
      runTicks(20);
      expect(room.players.get("alice")!.hp).toBe(PLAYER_MAX_HP);
      expect(bob.received(GAME_EVENTS.COMBAT.HIT)).toHaveLength(0);
      expect(bob.received(GAME_EVENTS.PICKUP.SPAWNED)).toHaveLength(0);
    });

    it("dead players may still respawn during the results", () => {
      const { alice, bob } = activeRound();
      killBob(alice, bob, SHORT_RULES.killLimit);
      expect(room.players.get("bob")!.status).toBe("dead");
      bob.send(GAME_EVENTS.PLAYER.RESPAWN, {});
      expect(room.players.get("bob")!.status).toBe("alive");
    });

    it("loops into a fresh countdown after the results, or back to warmup if a team left", () => {
      const { alice, bob } = activeRound();
      killBob(alice, bob, SHORT_RULES.killLimit);
      now = room.match.phaseEndsAt!;
      transport.clear();
      runTicks(1);

      expect(room.match.phase).toBe("countdown");
      expect(room.match.result).toBeNull();
      expect(room.teamScores).toEqual({ blue: 0, red: 0 });
      expect(room.players.get("bob")!.status).toBe("alive");
      expect(alice.received(GAME_EVENTS.GAME.STATE)).toHaveLength(1);
      expect(alice.received(GAME_EVENTS.MATCH.PHASE)[0].payload.phase).toBe("countdown");

      bob.disconnect();
      transport.clear();
      runTicks(1);
      expect(room.match.phase).toBe("warmup");
      expect(room.match.phaseEndsAt).toBeNull();
      expect(alice.received(GAME_EVENTS.MATCH.PHASE)[0].payload).toMatchObject({
        phase: "warmup",
        phaseEndsAt: null,
      });
      expect(alice.received(GAME_EVENTS.GAME.STATE)).toHaveLength(0); // no reset on the way back
    });

    it("keeps an active round going when a team empties", () => {
      const { bob } = activeRound();
      bob.disconnect();
      runTicks(5);
      expect(room.match.phase).toBe("active");
    });
  });
});
