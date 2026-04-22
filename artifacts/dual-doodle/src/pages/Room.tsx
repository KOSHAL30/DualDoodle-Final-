import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import type { Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth-context";
import { api, type StrokeData } from "@/lib/api";
import { getSocket, disconnectSocket } from "@/lib/socket";
import {
  Pen, Brush, Eraser, Square, Circle, Triangle, Minus,
  PaintBucket, Undo2, Save, Image as ImageIcon, X,
  Copy, Check, LogOut, Loader2, Users,
} from "lucide-react";

type Tool =
  | "pen" | "brush" | "eraser"
  | "line" | "rectangle" | "circle" | "triangle"
  | "fill";

const CANVAS_W = 800;
const CANVAS_H = 600;

const PALETTE = [
  "#1a1a2e", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

interface PendingStroke {
  id: number;
  side: "left" | "right";
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

  const [side, setSide] = useState<"left" | "right" | null>(null);
  const [creatorUsername, setCreatorUsername] = useState<string>("");
  const [joinerUsername, setJoinerUsername] = useState<string | null>(null);
  const [presence, setPresence] = useState<Array<{ username: string; role?: string }>>([]);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [status, setStatus] = useState<"connecting" | "ready" | "ended" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1a2e");
  const [size, setSize] = useState(4);

  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const socketRef = useRef<Socket | null>(null);
  const strokesRef = useRef<StrokeData[]>([]);
  const pendingRemoteRef = useRef<Map<string, PendingStroke>>(new Map());
  const drawingRef = useRef<{
    side: "left" | "right";
    tool: Tool;
    color: string;
    size: number;
    startX: number;
    startY: number;
    points: Array<{ x: number; y: number }>;
    lastEmit: number;
    pendingPoints: Array<{ x: number; y: number }>;
  } | null>(null);

  // Initial fetch + socket setup
  useEffect(() => {
    if (!code) return;
    let cancelled = false;

    api
      .joinSession(code)
      .then(({ session, role }) => {
        if (cancelled) return;
        setSide(role === "creator" ? "left" : "right");
        setCreatorUsername(session.creatorUsername);
        setJoinerUsername(session.joinerUsername);
        setReferenceImage(session.referenceImage);
        strokesRef.current = session.strokes;
        if (session.status === "ended") {
          setStatus("ended");
          return;
        }
        connectSocket();
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to join");
      });

    function connectSocket() {
      const socket = getSocket();
      socketRef.current = socket;

      socket.emit("session:join", { code }, (resp: {
        ok: boolean;
        error?: string;
        role?: "creator" | "joiner";
        side?: "left" | "right";
        session?: {
          creatorUsername: string;
          joinerUsername: string | null;
          status: string;
          referenceImage: string | null;
          strokes: StrokeData[];
        };
      }) => {
        if (!resp?.ok) {
          setStatus("error");
          setErrorMsg(resp?.error || "Could not join room");
          return;
        }
        setSide(resp.side || "left");
        if (resp.session) {
          setCreatorUsername(resp.session.creatorUsername);
          setJoinerUsername(resp.session.joinerUsername);
          setReferenceImage(resp.session.referenceImage);
          strokesRef.current = resp.session.strokes;
          redrawAll();
          if (resp.session.status === "ended") {
            setStatus("ended");
            return;
          }
        }
        setStatus("ready");
      });

      socket.on("presence:state", ({ present }: { present: Array<{ username: string; role?: string }> }) => {
        setPresence(present);
      });

      socket.on("presence:joined", () => {
        // refresh session info
        api.getSession(code).then(({ session }) => {
          setJoinerUsername(session.joinerUsername);
        }).catch(() => {});
      });

      socket.on("draw:stroke-start", (s: PendingStroke) => {
        pendingRemoteRef.current.set(`${s.userId}`, { ...s, points: [...s.points] });
      });

      socket.on("draw:stroke-progress", (p: { points: Array<{ x: number; y: number }>; userId: string; side: "left" | "right" }) => {
        const pending = pendingRemoteRef.current.get(p.userId);
        if (pending) {
          pending.points.push(...p.points);
          drawPreview();
        }
      });

      socket.on("draw:stroke-end", (s: StrokeData) => {
        pendingRemoteRef.current.delete(s.userId);
        strokesRef.current.push(s);
        redrawAll();
      });

      socket.on("draw:reset", ({ strokes }: { strokes: StrokeData[] }) => {
        strokesRef.current = strokes;
        redrawAll();
      });

      socket.on("reference:updated", ({ imageData }: { imageData: string | null }) => {
        setReferenceImage(imageData);
      });

      socket.on("session:ended", () => {
        setStatus("ended");
      });

      socket.on("connect_error", (err) => {
        setErrorMsg(`Connection error: ${err.message}`);
      });
    }

    return () => {
      cancelled = true;
      const s = socketRef.current;
      if (s) {
        s.off("presence:state");
        s.off("presence:joined");
        s.off("draw:stroke-start");
        s.off("draw:stroke-progress");
        s.off("draw:stroke-end");
        s.off("draw:reset");
        s.off("reference:updated");
        s.off("session:ended");
        s.off("connect_error");
      }
      disconnectSocket();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Render strokes onto canvas
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
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i]!.x, s.points[i]!.y);
      }
      ctx.stroke();
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
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === "triangle") {
      const a = s.points[0]!;
      const b = s.points[s.points.length - 1]!;
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, a.y);
      ctx.lineTo(a.x, b.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.stroke();
    } else if (s.tool === "fill") {
      const meta = s.meta as { x: number; y: number } | undefined;
      if (meta) {
        floodFill(ctx, Math.round(meta.x), Math.round(meta.y), s.color);
      }
    }
    ctx.restore();
  }

  function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const idx = (y * w + x) * 4;
    const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    const fill = hexToRgba(hex);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === fill[3]) return;
    const stack: number[] = [x, y];
    const tol = 8;
    while (stack.length) {
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const i = (cy * w + cx) * 4;
      if (
        Math.abs(data[i]! - target[0]!) > tol ||
        Math.abs(data[i + 1]! - target[1]!) > tol ||
        Math.abs(data[i + 2]! - target[2]!) > tol ||
        Math.abs(data[i + 3]! - target[3]!) > tol
      ) continue;
      data[i] = fill[0]!;
      data[i + 1] = fill[1]!;
      data[i + 2] = fill[2]!;
      data[i + 3] = fill[3]!;
      stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
    }
    ctx.putImageData(img, 0, 0);
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
    const left = leftCanvasRef.current;
    const right = rightCanvasRef.current;
    if (!left || !right) return;
    const lctx = left.getContext("2d");
    const rctx = right.getContext("2d");
    if (!lctx || !rctx) return;
    lctx.clearRect(0, 0, left.width, left.height);
    rctx.clearRect(0, 0, right.width, right.height);
    for (const s of strokesRef.current) {
      const ctx = s.side === "left" ? lctx : rctx;
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
    // Local pending
    const local = drawingRef.current;
    if (local) {
      ctx.save();
      const offset = local.side === "left" ? 0 : CANVAS_W;
      ctx.translate(offset, 0);
      drawStrokeOn(ctx, {
        tool: local.tool,
        color: local.color,
        size: local.size,
        points: local.points,
      });
      ctx.restore();
    }
    // Remote pending
    for (const p of pendingRemoteRef.current.values()) {
      ctx.save();
      const offset = p.side === "left" ? 0 : CANVAS_W;
      ctx.translate(offset, 0);
      drawStrokeOn(ctx, {
        tool: p.tool,
        color: p.color,
        size: p.size,
        points: p.points,
      });
      ctx.restore();
    }
  }

  // Mouse / touch handlers per side
  function getCanvasCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(s: "left" | "right", e: React.PointerEvent<HTMLCanvasElement>) {
    if (s !== side || status !== "ready" || !user) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasCoords(e);

    if (tool === "fill") {
      const stroke: StrokeData = {
        side: s,
        tool: "fill",
        color,
        size,
        points: [pt],
        meta: { x: pt.x, y: pt.y },
        userId: user.id,
        ts: Date.now(),
      };
      strokesRef.current.push(stroke);
      redrawAll();
      socketRef.current?.emit("draw:stroke-start", stroke);
      socketRef.current?.emit("draw:stroke-end", stroke);
      return;
    }

    drawingRef.current = {
      side: s,
      tool,
      color,
      size,
      startX: pt.x,
      startY: pt.y,
      points: [pt],
      lastEmit: 0,
      pendingPoints: [],
    };
    socketRef.current?.emit("draw:stroke-start", {
      side: s,
      tool,
      color,
      size,
      points: [pt],
      userId: user.id,
    });
    drawPreview();
  }

  function onPointerMove(s: "left" | "right", e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drawingRef.current;
    if (!d || d.side !== s) return;
    const pt = getCanvasCoords(e);
    if (d.tool === "pen" || d.tool === "brush" || d.tool === "eraser") {
      d.points.push(pt);
      d.pendingPoints.push(pt);
    } else {
      d.points = [{ x: d.startX, y: d.startY }, pt];
    }
    drawPreview();
    const now = performance.now();
    if (now - d.lastEmit > 30) {
      if (d.tool === "pen" || d.tool === "brush" || d.tool === "eraser") {
        if (d.pendingPoints.length) {
          socketRef.current?.emit("draw:stroke-progress", { points: d.pendingPoints });
          d.pendingPoints = [];
        }
      } else {
        socketRef.current?.emit("draw:stroke-progress", { points: [pt] });
      }
      d.lastEmit = now;
    }
  }

  function onPointerUp(s: "left" | "right", e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drawingRef.current;
    if (!d || d.side !== s || !user) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    const stroke: StrokeData = {
      side: d.side,
      tool: d.tool,
      color: d.color,
      size: d.size,
      points: d.points,
      userId: user.id,
      ts: Date.now(),
    };
    strokesRef.current.push(stroke);
    drawingRef.current = null;
    redrawAll();
    socketRef.current?.emit("draw:stroke-end", stroke);
  }

  // Tool actions
  const onUndo = () => {
    if (!user) return;
    // local optimistic: remove last stroke by this user
    for (let i = strokesRef.current.length - 1; i >= 0; i--) {
      if (strokesRef.current[i]!.userId === user.id) {
        strokesRef.current.splice(i, 1);
        break;
      }
    }
    redrawAll();
    socketRef.current?.emit("draw:undo", {});
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const combined = document.createElement("canvas");
      combined.width = CANVAS_W * 2;
      combined.height = CANVAS_H;
      const ctx = combined.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, combined.width, combined.height);
      if (leftCanvasRef.current) ctx.drawImage(leftCanvasRef.current, 0, 0);
      if (rightCanvasRef.current) ctx.drawImage(rightCanvasRef.current, CANVAS_W, 0);
      // divider
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(CANVAS_W - 1, 0, 2, CANVAS_H);
      const dataUrl = combined.toDataURL("image/png");
      await api.saveDrawing(code, dataUrl);
      // Trigger download
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
    if (!confirm("End this session for both of you?")) return;
    socketRef.current?.emit("session:end");
    try { await api.endSession(code); } catch {}
    setStatus("ended");
  };

  const onCopyLink = async () => {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const onUploadReference = (file: File) => {
    if (file.size > 3_500_000) {
      setErrorMsg("Image too large (max 3.5MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      socketRef.current?.emit("reference:set", { imageData: dataUrl }, (resp: { ok: boolean; error?: string }) => {
        if (!resp?.ok) setErrorMsg(resp?.error || "Failed to set reference");
      });
    };
    reader.readAsDataURL(file);
  };

  const onClearReference = () => {
    socketRef.current?.emit("reference:set", { imageData: null });
  };

  // Resize redraw on mount
  useEffect(() => {
    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tools: { key: Tool; label: string; Icon: typeof Pen }[] = useMemo(() => [
    { key: "pen", label: "Pen", Icon: Pen },
    { key: "brush", label: "Brush", Icon: Brush },
    { key: "eraser", label: "Eraser", Icon: Eraser },
    { key: "line", label: "Line", Icon: Minus },
    { key: "rectangle", label: "Rectangle", Icon: Square },
    { key: "circle", label: "Circle", Icon: Circle },
    { key: "triangle", label: "Triangle", Icon: Triangle },
    { key: "fill", label: "Fill", Icon: PaintBucket },
  ], []);

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
    <div className="dd-bg-gradient min-h-screen flex flex-col">
      <header className="border-b border-border/60 bg-background/70 backdrop-blur sticky top-0 z-20">
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
              <span className="text-muted-foreground">{presence.length}/2</span>
            </div>
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

      <div className="flex-1 max-w-[1400px] mx-auto w-full px-5 py-5 grid lg:grid-cols-[260px_1fr] gap-5">
        {/* Toolbar */}
        <aside className="dd-card p-4 h-fit lg:sticky lg:top-[80px] space-y-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Tools</div>
            <div className="grid grid-cols-4 gap-1.5">
              {tools.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setTool(key)}
                  data-active={tool === key}
                  className="dd-tool-btn"
                  title={label}
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
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Actions</div>
            <div className="space-y-1.5">
              <button
                onClick={onUndo}
                className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm"
              >
                <Undo2 className="w-4 h-4" /> Undo my last
              </button>
              <label className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm cursor-pointer">
                <ImageIcon className="w-4 h-4" /> Upload reference
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadReference(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {referenceImage && (
                <>
                  <button
                    onClick={() => setShowReference((v) => !v)}
                    className="w-full h-9 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-2 px-3 text-sm"
                  >
                    {showReference ? "Hide" : "Show"} reference
                  </button>
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
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary" />
                <span className="font-medium">{creatorUsername}</span>
                <span className="text-xs text-muted-foreground ml-auto">left</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${joinerUsername ? "bg-accent" : "bg-muted-foreground/30"}`} />
                <span className={`font-medium ${joinerUsername ? "" : "text-muted-foreground"}`}>
                  {joinerUsername || "Waiting for partner…"}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">right</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Canvas area */}
        <section className="space-y-3">
          {errorMsg && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="dd-tool-btn !w-7 !h-7"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {savedToast && (
            <div className="text-sm bg-primary/10 text-primary border border-primary/30 rounded-lg p-3">
              Saved to your history and downloaded.
            </div>
          )}

          <div className="dd-card p-3 canvas-shadow relative">
            <div
              className="relative w-full bg-white rounded-lg overflow-hidden mx-auto"
              style={{ aspectRatio: `${CANVAS_W * 2} / ${CANVAS_H}`, maxWidth: "100%" }}
            >
              {/* Reference background overlay */}
              {referenceImage && showReference && (
                <img
                  src={referenceImage}
                  alt="reference"
                  className="absolute inset-0 w-full h-full object-contain opacity-30 pointer-events-none"
                />
              )}

              {/* Two halves */}
              <div className="absolute inset-0 grid grid-cols-2">
                <div className="relative border-r border-dashed border-border">
                  <canvas
                    ref={leftCanvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    className="absolute inset-0 w-full h-full"
                    style={{ touchAction: "none", cursor: side === "left" ? "crosshair" : "not-allowed" }}
                    onPointerDown={(e) => onPointerDown("left", e)}
                    onPointerMove={(e) => onPointerMove("left", e)}
                    onPointerUp={(e) => onPointerUp("left", e)}
                    onPointerLeave={(e) => onPointerUp("left", e)}
                  />
                  <div className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full bg-background/80 backdrop-blur border border-border font-medium">
                    {side === "left" ? "You" : creatorUsername}
                  </div>
                </div>
                <div className="relative">
                  <canvas
                    ref={rightCanvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    className="absolute inset-0 w-full h-full"
                    style={{ touchAction: "none", cursor: side === "right" ? "crosshair" : "not-allowed" }}
                    onPointerDown={(e) => onPointerDown("right", e)}
                    onPointerMove={(e) => onPointerMove("right", e)}
                    onPointerUp={(e) => onPointerUp("right", e)}
                    onPointerLeave={(e) => onPointerUp("right", e)}
                  />
                  <div className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full bg-background/80 backdrop-blur border border-border font-medium">
                    {side === "right" ? "You" : (joinerUsername || "Waiting…")}
                  </div>
                </div>
              </div>

              {/* Preview overlay (in-progress strokes) */}
              <canvas
                ref={previewCanvasRef}
                width={CANVAS_W * 2}
                height={CANVAS_H}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </div>

            <div className="mt-3 text-xs text-muted-foreground text-center">
              You draw on the <span className="font-semibold text-foreground">{side === "left" ? "left" : "right"}</span> half. The dashed line is the divider.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
