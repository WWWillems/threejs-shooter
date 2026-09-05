import express from "express";
import * as http from "http";
import { Server as SocketIO } from "socket.io";
import cors from "cors";
import { TICK_RATE } from "@threejs-shooter/shared";
import { GameRoom } from "./room/GameRoom";
import { startTickLoop } from "./room/tickLoop";
import { loadServerLevel } from "./levelLoader";
import {
  attachSocketIO,
  SocketIOTransport,
  type GameServer,
} from "./adapters/socketio";

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
  }),
);

const io: GameServer = new SocketIO(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

const room = new GameRoom(new SocketIOTransport(io), {
  map: loadServerLevel(),
});
attachSocketIO(io, room);
startTickLoop(room, TICK_RATE);

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});

app.get("/leaderboard", (_req, res) => {
  res.send(room.leaderBoard);
});
