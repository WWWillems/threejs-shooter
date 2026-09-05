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

  it("propagates position updates to others and keeps last-known state", () => {
    const alice = client("alice").connect();
    const bob = client("bob").connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: "Alice", position: origin });
    bob.send(GAME_EVENTS.USER.JOINED, { name: "Bob", position: origin });
    transport.clear();

    const position = { x: 3, y: 1, z: -2 };
    alice.send(GAME_EVENTS.PLAYER.POSITION, { position, rotation: 1.5 });

    const [update] = bob.received(GAME_EVENTS.PLAYER.POSITION);
    expect(update.payload).toMatchObject({ userId: "alice", position });
    expect(alice.received(GAME_EVENTS.PLAYER.POSITION)).toHaveLength(0);
    expect(room.players.get("alice")).toMatchObject({ position, rotation: 1.5 });
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
