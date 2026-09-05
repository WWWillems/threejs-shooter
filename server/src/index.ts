import express from "express";
import * as http from "http";
import { Server as SocketIO } from "socket.io";
import {
  GAME_EVENTS,
  type ClientToServerEvents,
  type GameStateEvent,
  type Leaderboard,
  type PlayerSnapshot,
  type ServerToClientEvents,
} from "@threejs-shooter/shared";
import cors from "cors";

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "https://bang-bang.dapps.be",
  "https://bang-bang-teal.vercel.app/",
  "http://localhost:5173",
];

// Configure CORS for Express
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const io = new SocketIO<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

/** Last known state of every connected player, keyed by socket id. Used to sync late joiners. */
const players = new Map<string, PlayerSnapshot>();
const leaderBoard: Leaderboard = {};

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});

app.get("/leaderboard", (_req, res) => {
  res.send(leaderBoard);
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.broadcast.emit(GAME_EVENTS.USER.CONNECTED, {
    id: socket.id,
    userId: socket.id,
    message: "Welcome to the server",
  });

  socket.on(GAME_EVENTS.USER.JOINED, (payload) => {
    const name = payload.name || `Player-${socket.id.substring(0, 5)}`;

    // Sync the joiner with everyone already in the game, before registering them
    const state: GameStateEvent = { players: [...players.values()] };
    socket.emit(GAME_EVENTS.GAME.STATE, state);

    players.set(socket.id, {
      id: socket.id,
      userId: socket.id,
      name,
      status: "alive",
      position: payload.position,
      rotation: 0,
    });

    // Add player to leaderboard with initial stats
    leaderBoard[socket.id] = {
      id: socket.id,
      userId: socket.id,
      name,
      kills: 0,
      deaths: 0,
      score: 0,
    };

    socket.broadcast.emit(GAME_EVENTS.USER.JOINED, {
      id: socket.id,
      userId: socket.id,
      ...payload,
      name,
    });
  });

  socket.on(GAME_EVENTS.PLAYER.POSITION, (payload) => {
    const player = players.get(socket.id);
    if (player) {
      player.position = payload.position;
      player.rotation = payload.rotation;
    }

    socket.broadcast.emit(GAME_EVENTS.PLAYER.POSITION, {
      id: socket.id,
      userId: socket.id,
      ...payload,
    });
  });

  socket.on(GAME_EVENTS.PLAYER.STATUS, (payload) => {
    const player = players.get(socket.id);
    if (player) {
      player.status = payload.status;
      if (payload.position) {
        player.position = payload.position;
      }
    }

    socket.broadcast.emit(GAME_EVENTS.PLAYER.STATUS, {
      id: socket.id,
      userId: socket.id,
      ...payload,
    });
  });

  socket.on(GAME_EVENTS.WEAPON.SWITCH, (payload) => {
    socket.broadcast.emit(GAME_EVENTS.WEAPON.SWITCH, {
      id: socket.id,
      userId: socket.id,
      ...payload,
    });
  });

  socket.on(GAME_EVENTS.WEAPON.SHOOT, (payload) => {
    socket.broadcast.emit(GAME_EVENTS.WEAPON.SHOOT, {
      id: socket.id,
      userId: socket.id,
      ...payload,
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    players.delete(socket.id);
    delete leaderBoard[socket.id];

    socket.broadcast.emit(GAME_EVENTS.USER.DISCONNECTED, {
      id: socket.id,
      userId: socket.id,
      message: "A player left",
    });
  });
});
