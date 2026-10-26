import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

const BACKEND_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") || undefined;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  const token = getToken();
  socket = io(BACKEND_URL, {
    path: "/socket.io",
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
