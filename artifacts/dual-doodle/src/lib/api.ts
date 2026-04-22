const API_BASE = "/api";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

export interface SessionData {
  code: string;
  creatorId: string;
  creatorUsername: string;
  joinerId: string | null;
  joinerUsername: string | null;
  status: "waiting" | "active" | "ended";
  referenceImage: string | null;
  strokes: StrokeData[];
  createdAt: string;
  endedAt: string | null;
}

export interface StrokeData {
  side: "left" | "right";
  tool: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  meta?: Record<string, unknown>;
  userId: string;
  ts: number;
}

export interface DrawingHistoryItem {
  id: string;
  partnerUsername: string;
  sessionCode: string;
  imageData: string;
  createdAt: string;
}

const TOKEN_KEY = "dd_token";
const USER_KEY = "dd_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const errMsg =
      (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

export const api = {
  signup: (body: { username: string; email: string; password: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => request<{ user: AuthUser }>("/auth/me"),
  createSession: () => request<{ session: SessionData }>("/sessions", { method: "POST" }),
  joinSession: (code: string) =>
    request<{ session: SessionData; role: "creator" | "joiner" }>(
      `/sessions/${code}/join`,
      { method: "POST" },
    ),
  getSession: (code: string) =>
    request<{ session: SessionData; role: "creator" | "joiner" }>(`/sessions/${code}`),
  endSession: (code: string) =>
    request<{ session: SessionData }>(`/sessions/${code}/end`, { method: "POST" }),
  saveDrawing: (code: string, imageData: string) =>
    request<{ drawing: DrawingHistoryItem }>(`/sessions/${code}/save`, {
      method: "POST",
      body: JSON.stringify({ imageData }),
    }),
  listDrawings: () => request<{ drawings: DrawingHistoryItem[] }>("/drawings"),
  deleteDrawing: (id: string) =>
    request<{ ok: boolean }>(`/drawings/${id}`, { method: "DELETE" }),
};
