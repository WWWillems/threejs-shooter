import { beforeEach, describe, expect, it } from "vitest";
import { GAME_EVENTS } from "@threejs-shooter/shared";
import { GameRoom } from "./GameRoom";
import { MemoryClient, MemoryTransport } from "../adapters/memory";

describe("GameRoom", () => {
  let transport: MemoryTransport;
  let room: GameRoom;
  const client = (id: string) => new MemoryClient(id, room, transport);
  const origin = { x: 0, y: 1, z: 0 };

  beforeEach(() => {
    transport = new MemoryTransport();
    room = new GameRoom(transport);
  });

  it("sends a late joiner the players already in the game", () => {
    const alice = client("alice").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });

    const bob = client("bob").connect();
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });

    const [state] = bob.received(GAME_EVENTS.GAME.STATE);
    expect(state.payload.players.map((p) => p.name)).toEqual(["Alice"]);

    // Alice hears about Bob; Bob does not hear about himself.
    expect(alice.received(GAME_EVENTS.USER.JOINED)).toHaveLength(1);
    expect(alice.received(GAME_EVENTS.USER.JOINED)[0].payload.userId).toBe(
      "bob"
    );
    expect(bob.received(GAME_EVENTS.USER.JOINED)).toHaveLength(0);
  });

  it("ingests position updates and replicates them in the next snapshot", () => {
    const alice = client("alice").connect();
    const bob = client("bob").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });
    transport.clear();

    const position = { x: 3, y: 1, z: -2 };
    alice.send(GAME_EVENTS.PLAYER.POSITION, { position, rotation: 1.5 });
    expect(room.players.get("alice")).toMatchObject({ position, rotation: 1.5 });

    room.tick(0.05, 1000);

    const [snapshot] = bob.received(GAME_EVENTS.WORLD.SNAPSHOT);
    expect(snapshot.payload.serverTime).toBe(1000);
    expect(snapshot.payload.players).toContainEqual(
      expect.objectContaining({ id: "alice", position, rotation: 1.5 })
    );
    // Everyone gets the snapshot, including the sender (clients ignore their own entry).
    expect(alice.received(GAME_EVENTS.WORLD.SNAPSHOT)).toHaveLength(1);
  });

  it("numbers ticks monotonically", () => {
    const alice = client("alice").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });

    room.tick(0.05, 0);
    room.tick(0.05, 50);
    room.tick(0.05, 100);

    const ticks = alice
      .received(GAME_EVENTS.WORLD.SNAPSHOT)
      .map((m) => m.payload.tick);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it("tells the joiner its own id", () => {
    const alice = client("alice").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });
    expect(alice.received(GAME_EVENTS.GAME.STATE)[0].payload.selfId).toBe(
      "alice"
    );
  });

  it("removes a player on disconnect and tells the others", () => {
    const alice = client("alice").connect();
    const bob = client("bob").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });

    alice.disconnect();

    expect(room.players.has("alice")).toBe(false);
    expect(room.leaderBoard.alice).toBeUndefined();
    expect(bob.received(GAME_EVENTS.USER.DISCONNECTED)).toHaveLength(1);
  });

  it("ignores intents from sockets that never joined", () => {
    const bob = client("bob").connect();
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });
    transport.clear();

    const ghost = client("ghost").connect();
    ghost.send(GAME_EVENTS.WEAPON.SHOOT, { weaponType: "Pistol", action: "shoot" });

    expect(bob.received(GAME_EVENTS.WEAPON.SHOOT)).toHaveLength(0);
  });

  it("registers a joiner on the leaderboard with zeroed stats", () => {
    client("alice")
      .connect()
      .send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });

    expect(room.leaderBoard.alice).toEqual({
      id: "alice",
      userId: "alice",
      name: "Alice",
      kills: 0,
      deaths: 0,
      score: 0,
    });
  });
});
