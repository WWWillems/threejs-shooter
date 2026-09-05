import express from 'express';
import * as http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const GAME_EVENTS = {
  GAME: {
    /** Server -> joining client: snapshot of all players currently in the game. */
    STATE: "game:state"
  },
  WORLD: {
    /** Server -> all, every tick: continuous state of everything that moves. */
    SNAPSHOT: "world:snapshot"
  },
  USER: {
    /** Server -> others: a socket connected (before it joined the game). */
    CONNECTED: "user:connected",
    /** Client -> server: join the game. Server -> others: someone joined. */
    JOINED: "user:joined",
    /** Server -> others: a player left. */
    DISCONNECTED: "user:disconnected"
  },
  PLAYER: {
    /** Client -> server: my position. Replicated to others via WORLD.SNAPSHOT. */
    POSITION: "player:position",
    /** Client -> server: I died / respawned. Server -> others: same. */
    STATUS: "player:status"
  },
  WEAPON: {
    /** Client -> server: I fired. Server -> others: someone fired (cosmetic bullet). */
    SHOOT: "weapon:shoot",
    /** Client -> server: I switched weapon. Server -> others: same. */
    SWITCH: "weapon:switch"
  }
};

const TICK_RATE = 20;

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
class GameRoom {
  constructor(transport) {
    __publicField$1(this, "transport", transport);
    /** Last known state of every player who has joined, keyed by player id. */
    __publicField$1(this, "players", /* @__PURE__ */ new Map());
    __publicField$1(this, "leaderBoard", {});
    __publicField$1(this, "tickCount", 0);
  }
  /** A transport-level connection was established; the player has not joined yet. */
  connect(playerId) {
    this.transport.broadcast(
      GAME_EVENTS.USER.CONNECTED,
      { id: playerId, userId: playerId, message: "Welcome to the server" },
      playerId
    );
  }
  /** The connection dropped; remove the player if they had joined. */
  leave(playerId) {
    const wasPlaying = this.players.delete(playerId);
    delete this.leaderBoard[playerId];
    if (!wasPlaying) return;
    this.transport.broadcast(
      GAME_EVENTS.USER.DISCONNECTED,
      { id: playerId, userId: playerId, message: "A player left" },
      playerId
    );
  }
  /** Route a client -> server event to its handler. */
  applyIntent(playerId, event, payload) {
    switch (event) {
      case GAME_EVENTS.USER.JOINED:
        this.handleJoin(playerId, payload);
        break;
      case GAME_EVENTS.PLAYER.POSITION:
        this.handlePosition(playerId, payload);
        break;
      case GAME_EVENTS.PLAYER.STATUS:
        this.handleStatus(playerId, payload);
        break;
      case GAME_EVENTS.WEAPON.SHOOT:
        this.handleShoot(playerId, payload);
        break;
      case GAME_EVENTS.WEAPON.SWITCH:
        this.handleWeaponSwitch(playerId, payload);
        break;
      default: {
        const unhandled = event;
        throw new Error(`Unhandled intent: ${String(unhandled)}`);
      }
    }
  }
  /**
   * Advance the simulation by `dt` seconds and broadcast the resulting
   * world snapshot. `now` is the server clock in ms.
   */
  tick(_dt, now = Date.now()) {
    this.tickCount += 1;
    this.transport.broadcast(GAME_EVENTS.WORLD.SNAPSHOT, {
      tick: this.tickCount,
      serverTime: now,
      players: [...this.players.values()]
    });
  }
  handleJoin(playerId, payload) {
    const name = payload.name || `Player-${playerId.substring(0, 5)}`;
    this.transport.send(playerId, GAME_EVENTS.GAME.STATE, {
      selfId: playerId,
      players: [...this.players.values()]
    });
    this.players.set(playerId, {
      id: playerId,
      userId: playerId,
      name,
      status: "alive",
      position: payload.position,
      rotation: 0
    });
    this.leaderBoard[playerId] = {
      id: playerId,
      userId: playerId,
      name,
      kills: 0,
      deaths: 0,
      score: 0
    };
    this.transport.broadcast(
      GAME_EVENTS.USER.JOINED,
      { id: playerId, userId: playerId, ...payload, name },
      playerId
    );
  }
  handlePosition(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.position = payload.position;
    player.rotation = payload.rotation;
  }
  handleStatus(playerId, payload) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.status = payload.status;
    if (payload.position) {
      player.position = payload.position;
    }
    this.transport.broadcast(
      GAME_EVENTS.PLAYER.STATUS,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  handleShoot(playerId, payload) {
    if (!this.players.has(playerId)) return;
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SHOOT,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
  handleWeaponSwitch(playerId, payload) {
    if (!this.players.has(playerId)) return;
    this.transport.broadcast(
      GAME_EVENTS.WEAPON.SWITCH,
      { id: playerId, userId: playerId, ...payload },
      playerId
    );
  }
}

function startTickLoop(room, hz) {
  const stepMs = 1e3 / hz;
  const dt = 1 / hz;
  const maxCatchUpSteps = 5;
  let last = Date.now();
  let accumulator = 0;
  const handle = setInterval(() => {
    const now = Date.now();
    accumulator += now - last;
    last = now;
    let steps = 0;
    while (accumulator >= stepMs && steps < maxCatchUpSteps) {
      room.tick(dt, now);
      accumulator -= stepMs;
      steps += 1;
    }
    if (steps === maxCatchUpSteps) accumulator = 0;
  }, stepMs);
  return () => clearInterval(handle);
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
class SocketIOTransport {
  constructor(io) {
    __publicField(this, "io", io);
  }
  send(playerId, event, payload) {
    const args = [payload];
    this.io.to(playerId).emit(event, ...args);
  }
  broadcast(event, payload, exceptPlayerId) {
    const args = [payload];
    const target = exceptPlayerId ? this.io.except(exceptPlayerId) : this.io;
    target.emit(event, ...args);
  }
}
function attachSocketIO(io, room) {
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    room.connect(socket.id);
    socket.on(
      GAME_EVENTS.USER.JOINED,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.USER.JOINED, p)
    );
    socket.on(
      GAME_EVENTS.PLAYER.POSITION,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.PLAYER.POSITION, p)
    );
    socket.on(
      GAME_EVENTS.PLAYER.STATUS,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.PLAYER.STATUS, p)
    );
    socket.on(
      GAME_EVENTS.WEAPON.SHOOT,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SHOOT, p)
    );
    socket.on(
      GAME_EVENTS.WEAPON.SWITCH,
      (p) => room.applyIntent(socket.id, GAME_EVENTS.WEAPON.SWITCH, p)
    );
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      room.leave(socket.id);
    });
  });
}

const app = express();
const server = http.createServer(app);
const allowedOrigins = [
  "https://bang-bang.dapps.be",
  "https://bang-bang-teal.vercel.app/",
  "http://localhost:5173"
];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  })
);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
const PORT = process.env.PORT || 3e3;
const room = new GameRoom(new SocketIOTransport(io));
attachSocketIO(io, room);
startTickLoop(room, TICK_RATE);
server.listen(PORT, () => {
  console.log(`\u2705 Server listening on port ${PORT}`);
});
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});
app.get("/leaderboard", (_req, res) => {
  res.send(room.leaderBoard);
});
