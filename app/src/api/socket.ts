import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  Leaderboard,
  ServerToClientEvents,
} from "@threejs-shooter/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const url = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const socket: GameSocket = io(url);

export const getLeaderboard = async (): Promise<Leaderboard> => {
  try {
    const response = await fetch(`${url}/leaderboard`);
    if (!response.ok) {
      throw new Error(`Failed to fetch leaderboard: ${response.status}`);
    }
    return (await response.json()) as Leaderboard;
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return {};
  }
};

export default socket;
