import type { Server } from "socket.io";
import {
  GAME_EVENTS,
  type ClientToServerEvents,
  type ServerEventName,
  type ServerPayload,
  type ServerToClientEvents,
} from "@threejs-shooter/shared";
import type { GameRoom } from "../room/GameRoom";
import type { RoomTransport } from "../room/transport";

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** RoomTransport backed by a socket.io server. Player ids are socket ids. */
export class SocketIOTransport implements RoomTransport {
  constructor(private readonly io: GameServer) {}

  send<E extends ServerEventName>(
    playerId: string,
    event: E,
    payload: ServerPayload<E>
  ): void {
    const args = [payload] as Parameters<ServerToClientEvents[E]>;
    this.io.to(playerId).emit(event, ...args);
  }

  broadcast<E extends ServerEventName>(
    event: E,
    payload: ServerPayload<E>,
    exceptPlayerId?: string
  ): void {
    const args = [payload] as Parameters<ServerToClientEvents[E]>;
    const target = exceptPlayerId ? this.io.except(exceptPlayerId) : this.io;
    target.emit(event, ...args);
  }
}

/** Wire socket.io connection lifecycle and inbound events into the room. */
export function attachSocketIO(io: GameServer, room: GameRoom): void {
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    room.connect(socket.id);

    // socket.io's listener typing does not distribute over a generic event
    // name, so each contract event is registered explicitly.
    socket.on(GAME_EVENTS.USER.JOINED, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.USER.JOINED, p)
    );
    socket.on(GAME_EVENTS.PLAYER.POSITION, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.PLAYER.POSITION, p)
    );
    socket.on(GAME_EVENTS.PLAYER.RESPAWN, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.PLAYER.RESPAWN, p)
    );
    socket.on(GAME_EVENTS.WEAPON.SHOOT, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SHOOT, p)
    );
    socket.on(GAME_EVENTS.WEAPON.SWITCH, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SWITCH, p)
    );
    socket.on(GAME_EVENTS.PICKUP.CLAIM, (p) =>
      room.applyIntent(socket.id, GAME_EVENTS.PICKUP.CLAIM, p)
    );

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      room.leave(socket.id);
    });
  });
}
