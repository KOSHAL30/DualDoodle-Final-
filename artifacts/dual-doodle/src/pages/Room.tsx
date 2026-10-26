import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useRoute } from "wouter";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth-context";
import { api, type MessageData, type StrokeData } from "@/lib/api";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { pointerToCanvasPoint } from "@/lib/canvas-coordinates";
import { floodFillPixels } from "@/lib/canvas-flood-fill";
import {
  Pen, Brush, Eraser, Square, Circle, Triangle, Minus,
  PaintBucket, Pipette, Trash2, Undo2, Redo2, Save, Image as ImageIcon, X,
  Copy, Check, LogOut, Loader2, Users, MessageCircle, Send,
} from "@/lib/lucide-icons";

type Tool =
  | "pen" | "brush" | "eraser"
  | "line" | "rectangle" | "circle" | "triangle"
  | "fill" | "pipette";

const CANVAS_W = 1200;
const CANVAS_H = 900;

const PALETTE = [
  "#1a1a2e", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

interface PendingStroke {
  id: number;
  side: number;
  tool: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  meta?: Record<string, unknown>;
  userId: string;
}

export default function Room() {
  const [, params] = useRoute("/room/:code");
  const code = (params?.code || "").toUpperCase();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [side, setSide] = useState<number>(0);
  const [players, setPlayers] = useState<Array<{userId: string; username: string; slot: number}>>([]);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [presence, setPresence] = useState<Array<{ username: string; role?: string }>>([]);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [refOpacity, setRefOpacity] = useState(30);
  const [refScale, setRefScale] = useState(100);
  const [status, setStatus] = useState<"connecting" | "ready" | "ended" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [presenceToast, setPresenceToast] = useState<string | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<MessageData[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatOpenRef = useRef(chatOpen);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1a2e");
  const [size, setSize] = useState(4);

  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([null, null, null, null]);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [boardBox, setBoardBox] = useState({ width: 0, height: 0 });
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const gridCols = maxPlayers > 2 || workspaceWidth === 0 || workspaceWidth >= 560 ? 2 : 1;
  const gridRows = Math.ceil(maxPlayers / gridCols);
  const visualSlots = gridCols * gridRows;

  const socketRef = useRef<Socket | null>(null);
  const strokesRef = useRef<StrokeData[]>([]);
  const undoneStrokesRef = useRef<StrokeData[]>([]);
  const pendingRemoteRef = useRef<Map<string, PendingStroke>>(new Map());
  const drawingRef = useRef<{
    side: number;
    tool: Tool;
    color: string;
    size: number;
    startX: number;
    startY: number;
    points: Array<{ x: number; y: number }>;
    lastEmit: number;
    pendingPoints: Array<{ x: number; y: number }>;
  } | null>(null);

  function refreshHistoryAvailability() {
    setCanUndo(Boolean(user && strokesRef.current.some((stroke) => stroke.userId === user.id)));
    setCanRedo(Boolean(user && undoneStrokesRef.current.some((stroke) => stroke.userId === user.id)));
  }

  function refreshDrawingFromServer() {
    api.getSession(code).then(({ session }) => {
      strokesRef.current = session.strokes ?? [];
      undoneStrokesRef.current = session.undoneStrokes ?? [];
      refreshHistoryAvailability();
      redrawAll();
    }).catch((err) => {
      setErrorMsg(err instanceof Error ? err.message : "Could not resync the room drawing");
    });
  }

  function appendChatMessage(message: MessageData) {
    setChatMessages((current) => {
      const key = message.id ?? `${message.userId}:${message.ts}`;
      if (current.some((entry) => (entry.id ?? `${entry.userId}:${entry.ts}`) === key)) return current;
      return [...current, message].slice(-100);
    });
  }

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setUnreadChatCount(0);
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let cleanupSocketListeners: (() => void) | undefined;

    api
      .joinSession(code)
      .then(({ session, role }) => {
        if (cancelled) return;
        setSide(Number(role) || 0);
        setPlayers(session.players ?? []);
        setMaxPlayers(session.maxPlayers === 3 || session.maxPlayers === 4 ? session.maxPlayers : 2);
        setReferenceImage(session.referenceImage);
        strokesRef.current = session.strokes || [];
        undoneStrokesRef.current = session.undoneStrokes || [];
        refreshHistoryAvailability();
        if (session.status === "ended") {
          setStatus("ended");
          return;
        }
        cleanupSocketListeners = connectSocket();
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to join");
      });

    function connectSocket() {
      const socket = getSocket();
      socketRef.current = socket;

      const onJoined = (resp: {
        ok: boolean;
        error?: string;
        role?: string;
        side?: number;
        session?: {
          maxPlayers: number;
          players: Array<{userId: string; username: string; slot: number}>;
          status: string;
          referenceImage: string | null;
          strokes: StrokeData[];
          undoneStrokes?: StrokeData[];
          messages?: MessageData[];
        };
      }) => {
        if (!resp?.ok) {
          setStatus("error");
          setErrorMsg(resp?.error || "Could not join room");
          return;
        }
        setSide(Number(resp.side) || 0);
        if (resp.session) {
          setPlayers(resp.session.players ?? []);
          setMaxPlayers(resp.session.maxPlayers === 3 || resp.session.maxPlayers === 4 ? resp.session.maxPlayers : 2);
          setReferenceImage(resp.session.referenceImage);
          if (resp.session.referenceImage) setShowReference(true);
          strokesRef.current = resp.session.strokes ?? [];
          undoneStrokesRef.current = resp.session.undoneStrokes ?? [];
          setChatMessages(resp.session.messages ?? []);
          refreshHistoryAvailability();
          redrawAll();
          if (resp.session.status === "ended") {
            setStatus("ended");
            return;
          }
        }
        setErrorMsg(null);
        setStatus("ready");
      };

      const onConnect = () => {
        setStatus("connecting");
        socket.emit("session:join", { code }, onJoined);
      };

      const onDisconnect = () => {
        setStatus("connecting");
      };

      const onConnectError = (err: Error) => {
        setErrorMsg(`Connection error: ${err.message}`);
      };

      const onPresenceState = ({ present }: { present: Array<{ username: string; role?: string }> }) => {
        setPresence(present);
      };

      const onPresenceJoined = (payload?: { username?: string }) => {
        if (payload?.username && payload.username !== user?.username) {
          setPresenceToast(`${payload.username} joined the room`);
          setTimeout(() => {
            setPresenceToast((curr) => curr === `${payload.username} joined the room` ? null : curr);
          }, 3500);
        }
        api.getSession(code).then(({ session }) => {
          setPlayers(session.players ?? []);
          setMaxPlayers(session.maxPlayers === 3 || session.maxPlayers === 4 ? session.maxPlayers : 2);
        }).catch((err) => {
          setErrorMsg(err instanceof Error ? err.message : "Could not refresh room members");
        });
      };

      const onStrokeStart = (s: PendingStroke) => {
        pendingRemoteRef.current.set(`${s.userId}`, { ...s, points: [...s.points] });
      };

      const onStrokeProgress = (p: { points: Array<{ x: number; y: number }>; userId: string; side: number }) => {
        const pending = pendingRemoteRef.current.get(p.userId);
        if (pending) {
          pending.points.push(...p.points);
          drawPreview();
        }
      };
      const onStrokeEnd = (s: StrokeData) => {
        pendingRemoteRef.current.delete(s.userId);
        strokesRef.current.push(s);
        undoneStrokesRef.current = [];
        refreshHistoryAvailability();
        const canvas = canvasRefs.current[s.side];
        const context = canvas?.getContext("2d");
        if (context) drawStrokeOn(context, s);
        drawPreview();
      };

      const onStrokesSync = ({ strokes, undoneStrokes }: { strokes: StrokeData[]; undoneStrokes?: StrokeData[] }) => {
        strokesRef.current = strokes;
        undoneStrokesRef.current = undoneStrokes ?? [];
        refreshHistoryAvailability();
        redrawAll();
      };

      const onReferenceUpdated = ({ imageData }: { imageData: string | null }) => {
        setReferenceImage(imageData);
        if (imageData) setShowReference(true);
      };

      const onChatMessage = (message: MessageData) => {
        appendChatMessage(message);
        if (!chatOpenRef.current && message.userId !== user?.id) {
          setUnreadChatCount((count) => count + 1);
        }
      };

      const onSessionEnded = () => {
        setStatus("ended");
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      socket.on("presence:state", onPresenceState);
      socket.on("presence:joined", onPresenceJoined);
      socket.on("draw:stroke-start", onStrokeStart);
      socket.on("draw:stroke-move", onStrokeProgress);
      socket.on("draw:stroke-end", onStrokeEnd);
      socket.on("draw:sync", onStrokesSync);
      socket.on("reference:updated", onReferenceUpdated);
      socket.on("chat:message", onChatMessage);
      socket.on("session:ended", onSessionEnded);
      if (socket.connected) onConnect();

      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("connect_error", onConnectError);
        socket.off("presence:state", onPresenceState);
        socket.off("presence:joined", onPresenceJoined);
        socket.off("draw:stroke-start", onStrokeStart);
        socket.off("draw:stroke-move", onStrokeProgress);
        socket.off("draw:stroke-end", onStrokeEnd);
        socket.off("draw:sync", onStrokesSync);
        socket.off("reference:updated", onReferenceUpdated);
        socket.off("chat:message", onChatMessage);
        socket.off("session:ended", onSessionEnded);
      };
    }

    return () => {
      cancelled = true;
      cleanupSocketListeners?.();
      disconnectSocket();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function drawStrokeOn(ctx: CanvasRenderingContext2D, s: { tool: string; color: string; size: number; points: Array<{ x: number; y: number }>; meta?: Record<string, unknown> }) {
    if (!s.points || s.points.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;

    if (s.tool === "pen" || s.tool === "brush" || s.tool === "eraser") {
      if (s.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      }
      if (s.tool === "brush") {
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = s.size * 1.6;
      }
      ctx.beginPath();
      ctx.moveTo(s.points[0]!.x, s.points[0]!.y);
      if (s.points.length === 1) {
        ctx.arc(s.points[0]!.x, s.points[0]!.y, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i]!.x, s.points[i]!.y);
        }
        ctx.stroke();
      }
    } else if (s.tool === "line") {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (s.tool === "rectangle") {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (s.tool === "circle") {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const r = Math.hypot(b.x - a.x, b.y - a.y) / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === "triangle") {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(a.x, b.y);
      ctx.closePath();
      ctx.stroke();
    } else if (s.tool === "fill") {
      const p = s.points[0]!;
      const c = hexToRgba(s.color);
      floodFill(ctx, p.x, p.y, c);
    }
    ctx.restore();
  }

  function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, fillColor: [number, number, number, number]) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    if (floodFillPixels(img.data, w, h, x, y, fillColor)) ctx.putImageData(img, 0, 0);
  }

  function hexToRgba(hex: string): [number, number, number, number] {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return [r, g, b, 255];
  }

  function redrawAll() {
    canvasRefs.current.forEach(c => {
      if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    });
    for (const s of strokesRef.current) {
      const canvas = canvasRefs.current[s.side];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      drawStrokeOn(ctx, s);
    }
    drawPreview();
  }

  function drawPreview() {
    const preview = previewCanvasRef.current;
    if (!preview) return;
    const ctx = preview.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);
    
    const local = drawingRef.current;
    if (local) {
      ctx.save();
      const offset = (local.side % gridCols) * CANVAS_W;
      ctx.translate(offset, Math.floor(local.side / gridCols) * CANVAS_H);
      drawStrokeOn(ctx, {
        tool: local.tool,
        color: local.color,
        size: local.size,
        points: local.points,
      });
      ctx.restore();
    }

    for (const p of pendingRemoteRef.current.values()) {
      ctx.save();
      const offset = (p.side % gridCols) * CANVAS_W;
      ctx.translate(offset, Math.floor(p.side / gridCols) * CANVAS_H);
      drawStrokeOn(ctx, {
        tool: p.tool,
        color: p.color,
        size: p.size,
        points: p.points,
      });
      ctx.restore();
    }
  }

  function onPointerDown(s: number, e: React.PointerEvent) {
    if (tool === "pipette") {
      const canvas = canvasRefs.current[s];
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const { x, y } = pointerToCanvasPoint(e.clientX, e.clientY, rect, CANVAS_W, CANVAS_H);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          if (pixel[3] > 0) {
            const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
            setColor(hex);
          }
        }
      }
      setTool("pen");
      return;
    }
    if (s !== side || status !== "ready" || !user) return;
    const canvas = canvasRefs.current[s];
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture fails (e.g. synthetic event or disconnected pointer)
    }
    const rect = canvas.getBoundingClientRect();
    const { x, y } = pointerToCanvasPoint(e.clientX, e.clientY, rect, CANVAS_W, CANVAS_H);

    drawingRef.current = {
      side: s,
      tool,
      color,
      size,
      startX: x,
      startY: y,
      points: [{ x, y }],
      lastEmit: Date.now(),
      pendingPoints: [{ x, y }],
    };

    socketRef.current?.emit("draw:stroke-start", {
      id: Date.now(),
      tool,
      color,
      size,
      points: [{ x, y }],
    });
    drawPreview();
  }

  function onPointerMove(s: number, e: React.PointerEvent) {
    const d = drawingRef.current;
    if (!d || d.side !== s || !user) return;
    const canvas = canvasRefs.current[s];
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = pointerToCanvasPoint(e.clientX, e.clientY, rect, CANVAS_W, CANVAS_H);

    d.points.push({ x, y });
    d.pendingPoints.push({ x, y });

    const now = Date.now();
    if (now - d.lastEmit > 30) {
      if (d.pendingPoints.length > 0) {
        socketRef.current?.emit("draw:stroke-move", {
          points: d.pendingPoints,
        });
        d.pendingPoints = [];
      }
      d.lastEmit = now;
    }
    drawPreview();
  }

  function onPointerUp(s: number, e: React.PointerEvent) {
    const d = drawingRef.current;
    if (!d || d.side !== s || !user) return;
    const canvas = canvasRefs.current[s];
    const rect = canvas?.getBoundingClientRect();
    if (rect) {
      const point = pointerToCanvasPoint(e.clientX, e.clientY, rect, CANVAS_W, CANVAS_H);
      const last = d.points[d.points.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) d.points.push(point);
    }

    const sData = {
      tool: d.tool,
      color: d.color,
      size: d.size,
      points: d.points,
    };
    const localStroke: StrokeData = { ...sData, side: s, userId: user.id, ts: Date.now() };
    strokesRef.current.push(localStroke);
    undoneStrokesRef.current = [];
    refreshHistoryAvailability();
    
    const targetCanvas = canvasRefs.current[d.side];
    const realCtx = targetCanvas?.getContext("2d");
    if (realCtx) {
      drawStrokeOn(realCtx, sData);
    }
    
    try {
      canvas?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture release fails
    }

    drawingRef.current = null;
    drawPreview();

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.timeout(10000).emit("draw:stroke-end", sData, (err: Error | null, response: { ok: boolean; error?: string }) => {
        if (err || !response?.ok) {
          strokesRef.current = strokesRef.current.filter((stroke) => stroke !== localStroke);
          refreshHistoryAvailability();
          redrawAll();
          setErrorMsg(response?.error || "Stroke could not be saved. Please try again.");
          refreshDrawingFromServer();
        }
      });
    } else {
      strokesRef.current = strokesRef.current.filter((stroke) => stroke !== localStroke);
      refreshHistoryAvailability();
      redrawAll();
      setErrorMsg("Room connection lost. Reconnect before drawing.");
      refreshDrawingFromServer();
    }
  }

  const onUndo = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("Room connection lost. Reconnect before undoing a stroke.");
      return;
    }
    socket.timeout(8000).emit("draw:undo", {}, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err || !response?.ok) setErrorMsg(response?.error || "Undo request timed out. Please try again.");
    });
  };

  const onRedo = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("Room connection lost. Reconnect before redoing a stroke.");
      return;
    }
    socket.timeout(8000).emit("draw:redo", {}, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err || !response?.ok) setErrorMsg(response?.error || "Redo request timed out. Please try again.");
    });
  };

  const onClearSection = () => {
    if (!canUndo) return;
    if (!confirm("Clear your section of the canvas? (You can undo this)")) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("Room connection lost. Reconnect before clearing your section.");
      return;
    }
    socket.timeout(8000).emit("draw:clear", {}, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err || !response?.ok) setErrorMsg(response?.error || "Clear request timed out. Please try again.");
    });
  };

  const onSendChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatInput.trim();
    const socket = socketRef.current;
    if (!text || chatSending) return;
    if (!socket?.connected) {
      setChatError("Reconnecting. Your message was not sent.");
      return;
    }

    setChatSending(true);
    setChatError(null);
    socket.timeout(8000).emit("chat:message", { text }, (err: Error | null, response: { ok: boolean; error?: string }) => {
      setChatSending(false);
      if (err || !response?.ok) {
        setChatError(response?.error || "Message could not be sent. Please try again.");
        return;
      }
      setChatInput("");
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const combined = document.createElement("canvas");
      const cols = maxPlayers > 2 ? 2 : maxPlayers;
      const rows = maxPlayers > 2 ? 2 : 1;
      combined.width = CANVAS_W * cols;
      combined.height = CANVAS_H * rows;
      const ctx = combined.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, combined.width, combined.height);
      
      for (let i = 0; i < maxPlayers; i++) {
        const c = canvasRefs.current[i];
        if (c) ctx.drawImage(c, (i % 2) * CANVAS_W, Math.floor(i / 2) * CANVAS_H);
      }
      
      // dividers
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(CANVAS_W - 1, 0, 2, combined.height);
      if (maxPlayers > 2) {
        const dividerWidth = maxPlayers === 3 ? CANVAS_W : combined.width;
        ctx.fillRect(0, CANVAS_H - 1, dividerWidth, 2);
      }

      const dataUrl = combined.toDataURL("image/png");
      await api.saveDrawing(code, dataUrl);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `dual-doodle-${code}.png`;
      a.click();
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onEnd = async () => {
    if (!confirm("End this session for everyone?")) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("The room connection is unavailable. Reconnect before ending the session.");
      return;
    }
    socket.timeout(8000).emit("session:end", {}, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err || !response?.ok) {
        setErrorMsg(response?.error || "Could not end this session. Please retry.");
        return;
      }
      setStatus("ended");
    });
  };

  const onCopyLink = async () => {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErrorMsg("Could not copy the invite link. Copy the room URL from your browser instead.");
    }
  };

  const onUploadReference = async (file: File) => {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    if (!allowedTypes.has(file.type.toLowerCase())) {
      setErrorMsg("Choose a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > 3_500_000) {
      setErrorMsg("Image too large (max 3.5MB)");
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("Reconnect to the room before uploading a reference.");
      return;
    }

    setReferenceUploading(true);
    setErrorMsg(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("This image could not be decoded."));
        image.src = objectUrl;
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Could not read the selected image."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected image."));
        reader.readAsDataURL(file);
      });
      const response = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
        socket.timeout(10000).emit("reference:set", { imageData: dataUrl }, (err: Error | null, result: { ok: boolean; error?: string }) => {
          if (err) reject(new Error("The reference upload timed out. Please try again."));
          else resolve(result);
        });
      });
      if (!response.ok) throw new Error(response.error || "Failed to set reference");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to upload reference");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setReferenceUploading(false);
    }
  };

  const onClearReference = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setErrorMsg("Reconnect to the room before clearing the reference.");
      return;
    }
    socket.timeout(8000).emit("reference:set", { imageData: null }, (err: Error | null, response: { ok: boolean; error?: string }) => {
      if (err || !response?.ok) setErrorMsg(response?.error || "Could not clear the reference.");
    });
  };

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const aspect = (CANVAS_W * gridCols) / (CANVAS_H * gridRows);
    const apply = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setWorkspaceWidth(w);
      let width = w;
      let height = width / aspect;
      if (height > h) {
        height = h;
        width = height * aspect;
      }
      setBoardBox({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridCols, gridRows, status]);

  useEffect(() => {
    if (status !== "ready" && status !== "connecting") return;
    const id = requestAnimationFrame(() => redrawAll());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, maxPlayers]);

  const tools: { key: Tool; label: string; shortcut: string; Icon: typeof Pen }[] = useMemo(() => [
    { key: "pen", label: "Pen", shortcut: "P", Icon: Pen },
    { key: "brush", label: "Brush", shortcut: "B", Icon: Brush },
    { key: "eraser", label: "Eraser", shortcut: "E", Icon: Eraser },
    { key: "line", label: "Line", shortcut: "L", Icon: Minus },
    { key: "rectangle", label: "Rectangle", shortcut: "R", Icon: Square },
    { key: "circle", label: "Circle", shortcut: "C", Icon: Circle },
    { key: "triangle", label: "Triangle", shortcut: "T", Icon: Triangle },
    { key: "fill", label: "Fill", shortcut: "F", Icon: PaintBucket },
    { key: "pipette", label: "Eyedropper", shortcut: "I", Icon: Pipette },
  ], []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isUndo = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z";
      const isRedo =
        ((isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
        (!isMac && e.ctrlKey && e.key.toLowerCase() === "y");

      if (isUndo) {
        e.preventDefault();
        if (canUndo && status === "ready") onUndo();
        return;
      }
      if (isRedo) {
        e.preventDefault();
        if (canRedo && status === "ready") onRedo();
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "p":
            setTool("pen");
            break;
          case "b":
            setTool("brush");
            break;
          case "e":
            setTool("eraser");
            break;
          case "l":
            setTool("line");
            break;
          case "r":
            setTool("rectangle");
            break;
          case "c":
            setTool("circle");
            break;
          case "t":
            setTool("triangle");
            break;
          case "f":
            setTool("fill");
            break;
          case "i":
            setTool("pipette");
            break;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, status]);

  if (status === "error") {
    return (
      <div className="dd-bg-gradient min-h-screen flex items-center justify-center p-6">
        <div className="dd-card p-8 max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">Couldn't open this room</h1>
          <p className="text-sm text-muted-foreground mb-5">{errorMsg}</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="h-10 px-5 rounded-lg bg-primary text-primary-foreground font-medium"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="dd-bg-gradient min-h-screen flex items-center justify-center p-6">
        <div className="dd-card p-8 max-w-md text-center">
          <h1 className="text-xl font-bold mb-2">Session ended</h1>
          <p className="text-sm text-muted-foreground mb-5">
            This room is closed. Saved doodles live in your dashboard.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="h-10 px-5 rounded-lg bg-primary text-primary-foreground font-medium"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dd-bg-gradient h-dvh max-h-dvh min-h-0 min-w-0 w-full max-w-full flex flex-col overflow-hidden">
      <header className="border-b border-border/60 bg-background/70 backdrop-blur shrink-0 z-20">
        <div className="max-w-[1400px] mx-auto px-5 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/dashboard")}
              className="dd-tool-btn"
              title="Back to dashboard"
            >
              <LogOut className="w-4 h-4 rotate-180" />
            </button>
            <div>
              <div className="text-sm text-muted-foreground">Room</div>
              <div className="font-mono font-bold tracking-[0.3em] text-lg">{code}</div>
            </div>
            <button
              onClick={onCopyLink}
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-1.5 text-sm"
              title="Copy invite link"
            >
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Invite link"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">{presence.length}/{maxPlayers}</span>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen((open) => !open)}
              aria-expanded={chatOpen}
              aria-controls="room-chat"
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-1.5 text-sm"
            >
              <MessageCircle className="w-4 h-4" /> Chat
              {unreadChatCount > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center" aria-label={`${unreadChatCount} unread messages`}>
                  {unreadChatCount > 9 ? "9+" : unreadChatCount}
                </span>
              )}
            </button>
            {status === "connecting" && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…
              </span>
            )}
            {status === "ready" && (
              <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                Live
              </span>
            )}

            <button
              onClick={onSave}
              disabled={saving}
              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5 text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
            <button
              onClick={onEnd}
              className="h-9 px-3 rounded-lg border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 transition flex items-center gap-1.5 text-sm font-medium"
            >
              End session
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
      <div className="h-full min-h-0 min-w-0 max-w-[1600px] mx-auto w-full px-4 py-4 grid grid-cols-1 grid-rows-[minmax(0,30vh)_minmax(0,1fr)] sm:grid-rows-[minmax(0,36vh)_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1 gap-4 overflow-hidden">
        <aside className="dd-card p-4 space-y-5 min-h-0 min-w-0 overflow-y-auto max-h-[30vh] sm:max-h-[36vh] lg:max-h-none">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Tools</div>
            <div className="grid grid-cols-5 gap-1.5">
              {tools.map(({ key, label, shortcut, Icon }) => (
                <button
                  key={key}
                  onClick={() => setTool(key)}
                  data-active={tool === key}
                  className="dd-tool-btn"
                  title={`${label} (${shortcut})`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Color</div>
            <div className="grid grid-cols-5 gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-9 h-9 rounded-lg border-2 transition"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "hsl(var(--primary))" : "hsl(var(--border))",
                  }}
                  title={c}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-9 rounded-lg border border-border bg-transparent cursor-pointer"
              />
              <div className="font-mono text-xs text-muted-foreground">{color}</div>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold flex items-center justify-between">
              <span>Brush size</span>
              <span className="font-mono text-foreground">{size}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={48}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="mt-2 h-10 rounded-lg border border-border/70 bg-muted/40 flex items-center justify-center overflow-hidden">
              <div
                className="rounded-full transition-all shrink-0"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: tool === "eraser" ? "hsl(var(--muted-foreground))" : color,
                }}
              />
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Actions</div>
            <div className="space-y-1.5">
              <button
                onClick={onUndo}
                disabled={!canUndo || status !== "ready"}
                className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm disabled:opacity-45 disabled:cursor-not-allowed"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" /> Undo my last
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo || status !== "ready"}
                className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm disabled:opacity-45 disabled:cursor-not-allowed"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" /> Redo my last
              </button>
              <button
                type="button"
                onClick={onClearSection}
                disabled={!canUndo || status !== "ready"}
                className="w-full h-9 rounded-lg border border-border bg-card hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition flex items-center gap-2 px-3 text-sm disabled:opacity-45 disabled:cursor-not-allowed"
                title="Clear all drawings on your side"
              >
                <Trash2 className="w-4 h-4" /> Clear my section
              </button>
              <label className={`w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm ${referenceUploading ? "opacity-50 cursor-wait" : "cursor-pointer"}`} aria-disabled={referenceUploading}>
                <ImageIcon className="w-4 h-4" /> {referenceUploading ? "Validating reference…" : "Upload reference"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={referenceUploading || status !== "ready"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUploadReference(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">Reference images are shared with everyone in the room.</p>
              {referenceImage && (
                <>
                  <button
                    onClick={() => setShowReference((v) => !v)}
                    className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center justify-center text-sm font-medium"
                  >
                    {showReference ? "Hide" : "Show"} reference
                  </button>
                  {showReference && (
                    <div className="px-1 py-2 space-y-3">
                      <div>
                        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                          <span>Opacity</span>
                          <span>{refOpacity}%</span>
                        </div>
                        <input type="range" min={5} max={100} value={refOpacity} onChange={(e) => setRefOpacity(Number(e.target.value))} className="w-full accent-primary h-1.5 cursor-pointer" />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                          <span>Zoom</span>
                          <span>{refScale}%</span>
                        </div>
                        <input type="range" min={10} max={300} value={refScale} onChange={(e) => setRefScale(Number(e.target.value))} className="w-full accent-primary h-1.5 cursor-pointer" />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={onClearReference}
                    className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm text-destructive"
                  >
                    <X className="w-4 h-4" /> Clear reference
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Players</div>
            <div className="space-y-1.5 text-sm">
              {Array.from({ length: maxPlayers }).map((_, i) => {
                const p = (players || []).find(x => x.slot === i);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${p ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    <span className={`font-medium ${p ? "" : "text-muted-foreground"}`}>
                      {p ? p.username : "Empty slot"}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">P{i+1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="relative flex flex-col gap-3 min-h-0 min-w-0 overflow-hidden">
          {errorMsg && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-center justify-between shrink-0">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="dd-tool-btn !w-7 !h-7"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {savedToast && (
            <div className="text-sm bg-primary/10 text-primary border border-primary/30 rounded-lg p-3 shrink-0">
              Saved to your history and downloaded.
            </div>
          )}
          {presenceToast && (
            <div className="text-sm bg-primary/15 text-primary border border-primary/30 rounded-lg px-3 py-2 shrink-0 flex items-center gap-2">
              <Users className="w-4 h-4 shrink-0" />
              <span>{presenceToast}</span>
            </div>
          )}

          <div className="dd-card p-3 canvas-shadow flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <div ref={workspaceRef} className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
            <div
              className="relative bg-white rounded-lg overflow-hidden shrink-0"
              style={{
                width: boardBox.width ? `${boardBox.width}px` : "100%",
                height: boardBox.height ? `${boardBox.height}px` : "100%",
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              {referenceImage && showReference && (
                <img
                  src={referenceImage}
                  alt="reference"
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  style={{
                    opacity: refOpacity / 100,
                    transform: `scale(${refScale / 100})`,
                    transformOrigin: "center center"
                  }}
                />
              )}

              <div className={`absolute inset-0 grid min-h-0 min-w-0 ${maxPlayers > 2 ? "grid-cols-2 grid-rows-2" : gridCols === 1 ? "grid-cols-1 grid-rows-2" : "grid-cols-2 grid-rows-1"}`}>
                {Array.from({ length: visualSlots }).map((_, i) => {
                  const p = (players ?? []).find((x) => x.slot === i);
                  const isPlayable = i < maxPlayers;
                  return (
                    <div
                      key={i}
                      className={`relative min-h-0 min-w-0 overflow-hidden ${gridCols > 1 && i % gridCols === 0 ? "border-r" : ""} ${gridRows > 1 && i < gridCols * (gridRows - 1) ? "border-b" : ""} border-dashed border-border ${isPlayable ? "bg-transparent" : "bg-muted/40"}`}
                    >
                      {isPlayable ? (
                        <canvas
                          ref={(el) => { canvasRefs.current[i] = el; }}
                          width={CANVAS_W}
                          height={CANVAS_H}
                          className="absolute inset-0 w-full h-full max-w-full max-h-full"
                          style={{ touchAction: "none", cursor: tool === "pipette" ? "crosshair" : side === i ? "crosshair" : "not-allowed" }}
                          onPointerDown={(e) => onPointerDown(i, e)}
                          onPointerMove={(e) => onPointerMove(i, e)}
                          onPointerUp={(e) => onPointerUp(i, e)}
                          onPointerCancel={(e) => onPointerUp(i, e)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                          Empty slot
                        </div>
                      )}
                      <div className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full bg-background/80 backdrop-blur border border-border font-medium z-10">
                        {isPlayable ? (side === i ? "You" : (p ? p.username : "Waiting…")) : "Unused"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <canvas
                ref={previewCanvasRef}
                width={CANVAS_W * gridCols}
                height={CANVAS_H * gridRows}
                className="absolute inset-0 w-full h-full max-w-full max-h-full pointer-events-none"
              />
            </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground text-center shrink-0">
              You draw on your assigned section. The dashed line is the divider.
            </div>
          </div>
          {chatOpen && (
            <aside id="room-chat" aria-label="Room chat" className="absolute right-3 bottom-3 z-30 dd-card flex flex-col overflow-hidden shadow-xl" style={{ width: "min(22rem, calc(100vw - 2rem))", height: "min(27rem, calc(100% - 1.5rem))" }}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                <div>
                  <h2 className="font-semibold text-sm">Room chat</h2>
                  <p className="text-xs text-muted-foreground">Messages are visible to this room.</p>
                </div>
                <button type="button" onClick={() => setChatOpen(false)} className="dd-tool-btn !w-8 !h-8" aria-label="Close room chat">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {status !== "ready" && <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/60">Reconnecting to the room…</div>}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" aria-live="polite" aria-relevant="additions">
                {chatMessages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Say hello!</p>
                ) : chatMessages.map((message, index) => (
                  <div key={message.id ?? `${message.userId}-${message.ts}-${index}`} className="text-sm break-words">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{message.username}</span>
                      <time className="text-[10px] text-muted-foreground" dateTime={new Date(message.ts).toISOString()}>
                        {new Date(message.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
              {chatError && <p role="alert" className="px-3 pb-1 text-xs text-destructive">{chatError}</p>}
              <form onSubmit={onSendChat} className="p-2 border-t border-border flex gap-2 shrink-0">
                <label className="sr-only" htmlFor="room-chat-input">Message</label>
                <input
                  id="room-chat-input"
                  value={chatInput}
                  maxLength={500}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Write a message…"
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-input bg-background text-sm"
                  disabled={status !== "ready" || chatSending}
                />
                <button type="submit" aria-label="Send message" disabled={status !== "ready" || chatSending || !chatInput.trim()} className="h-9 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-45">
                  {chatSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </aside>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}
