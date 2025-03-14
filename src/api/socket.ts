import { io } from "socket.io-client";

const url = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const socket = io(url);

export default socket;
