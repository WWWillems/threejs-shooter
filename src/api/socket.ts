import { io } from "socket.io-client";

const url = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const socket = io(url);

export const getLeaderboard = async () => {
  try {
    const response = await fetch(`${url}/leaderboard`);
    if (!response.ok) {
      throw new Error(`Failed to fetch leaderboard: ${response.status}`);
    }
    const data = await response.json();

    return data;
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return [];
  }
};

export default socket;
