import { describe, expect, it, vi } from "vitest";
import { GAME_EVENTS } from "@threejs-shooter/shared";
import { NetworkClient } from "./NetworkClient";
import { FakeSocket } from "./FakeSocket";

const setup = () => {
  const socket = new FakeSocket();
  const net = new NetworkClient(socket, "http://test");
  return { socket, net };
};

describe("NetworkClient", () => {
  it("stamps outgoing events with a timestamp", () => {
    const { socket, net } = setup();
    net.send(GAME_EVENTS.PLAYER.POSITION, {
      position: { x: 1, y: 2, z: 3 },
      rotation: 0.5,
    });

    const [[payload]] = socket.emittedOf(GAME_EVENTS.PLAYER.POSITION);
    expect(payload).toMatchObject({ position: { x: 1, y: 2, z: 3 } });
    expect(typeof (payload as { timestamp: number }).timestamp).toBe("number");
  });

  it("sends chat messages through the shared event contract", () => {
    const { socket, net } = setup();
    net.send(GAME_EVENTS.CHAT.MESSAGE, { text: "hello" });

    const [[payload]] = socket.emittedOf(GAME_EVENTS.CHAT.MESSAGE);
    expect(payload).toMatchObject({ text: "hello" });
    expect(typeof (payload as { timestamp: number }).timestamp).toBe("number");
  });

  it("delivers server events to typed handlers and supports unsubscribe", () => {
    const { socket, net } = setup();
    const handler = vi.fn();
    const off = net.on(GAME_EVENTS.USER.JOINED, handler);

    const payload = {
      id: "a",
      userId: "a",
      name: "Alice",
      position: { x: 0, y: 0, z: 0 },
      timestamp: 1,
    };
    socket.receive(GAME_EVENTS.USER.JOINED, payload);
    expect(handler).toHaveBeenCalledWith(payload);

    off();
    socket.receive(GAME_EVENTS.USER.JOINED, payload);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers canonical chat messages to subscribers", () => {
    const { socket, net } = setup();
    const handler = vi.fn();
    net.on(GAME_EVENTS.CHAT.MESSAGE, handler);
    const payload = {
      messageId: "alice-1",
      senderId: "alice",
      senderName: "Alice",
      text: "Hello",
      serverTime: 1,
    };

    socket.receive(GAME_EVENTS.CHAT.MESSAGE, payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("re-joins with the current position after a reconnect", () => {
    const { socket, net } = setup();
    socket.connect();
    const position = { x: 0, y: 1, z: 0 };
    net.join("Alice", () => position);
    expect(socket.emittedOf(GAME_EVENTS.USER.JOINED)).toHaveLength(1);

    position.x = 7;
    socket.disconnect();
    socket.connect();

    const joins = socket.emittedOf(GAME_EVENTS.USER.JOINED);
    expect(joins).toHaveLength(2);
    expect(joins[1][0]).toMatchObject({ name: "Alice", position: { x: 7 } });
  });

  it("does not join on connect before the player has started the game", () => {
    const { socket } = setup();
    socket.connect();
    expect(socket.emittedOf(GAME_EVENTS.USER.JOINED)).toHaveLength(0);
  });
});
