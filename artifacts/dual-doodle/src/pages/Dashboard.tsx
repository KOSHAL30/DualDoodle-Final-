import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { api, type DrawingHistoryItem } from "@/lib/api";
import { Palette, Plus, LogIn, LogOut, Image as ImageIcon, Loader2, Trash2, Download } from "@/lib/lucide-icons";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DrawingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { drawings } = await api.listDrawings();
      setHistory(drawings);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load your saved doodles");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const onCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { session } = await api.createSession(maxPlayers);
      navigate(`/room/${session.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create session");
      setCreating(false);
    }
  };

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const trimmed = code.trim().toUpperCase();
      await api.joinSession(trimmed);
      navigate(`/room/${trimmed}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join session");
      setJoining(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this doodle from your history?")) return;
    try {
      await api.deleteDrawing(id);
      setHistory((h) => h.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this saved doodle");
    }
  };

  const downloadImage = (item: DrawingHistoryItem) => {
    const a = document.createElement("a");
    a.href = item.imageData;
    a.download = `dual-doodle-${item.sessionCode}.png`;
    a.click();
  };

  return (
    <div
      className="dd-page-fade-in dd-bg-gradient min-h-screen"
    >
      <header className="border-b border-border/60 bg-background/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold leading-tight">Dual Doodle</div>
              <div className="text-xs text-muted-foreground">Two artists. One canvas.</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-right hidden sm:block">
              <div className="font-medium">{user?.username}</div>
              <div className="text-xs text-muted-foreground">{user?.email}</div>
            </div>
            <ThemeToggle />
            <button
              onClick={logout}
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition flex items-center gap-1.5 text-sm"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section className="grid md:grid-cols-2 gap-6">
          <div className="dd-card p-6 canvas-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold">Create a session</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Spin up a new room and share the code with a friend.
            </p>
            <fieldset className="mb-4">
              <legend className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
                Number of players
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {([2, 3, 4] as const).map((n) => (
                  <label
                    key={n}
                    className={`relative flex h-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium transition focus-within:ring-2 focus-within:ring-ring ${
                      maxPlayers === n
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="maxPlayers"
                      value={n}
                      checked={maxPlayers === n}
                      onChange={() => setMaxPlayers(n)}
                    />
                    {n} players
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              onClick={onCreate}
              disabled={creating}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              New canvas
            </button>
          </div>

          <div className="dd-card p-6 canvas-shadow">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center">
                <LogIn className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold">Join with a code</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Enter a room code your partner shared with you.
            </p>
            <form onSubmit={onJoin} className="flex gap-2">
              <label htmlFor="join-room-code" className="sr-only">Room code</label>
              <input
                id="join-room-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                maxLength={6}
                required
                pattern="[A-HJ-NP-Z2-9]{6}"
                title="Enter the 6-character room code"
                className="flex-1 h-11 px-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring uppercase tracking-[0.3em] text-center font-mono"
              />
              <button
                type="submit"
                disabled={joining || !code.trim()}
                className="h-11 px-5 rounded-lg bg-secondary text-secondary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Join
              </button>
            </form>
          </div>
        </section>

        {error && (
          <div role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
              Your doodle history
            </h2>
            <div className="text-sm text-muted-foreground">{history.length} saved</div>
          </div>
          {historyLoading ? (
            <div className="dd-card p-10 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading your gallery…
            </div>
          ) : historyError ? (
            <div role="alert" className="dd-card p-8 text-center">
              <p className="text-sm text-destructive mb-4">{historyError}</p>
              <button type="button" onClick={() => void loadHistory()} className="h-9 px-4 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium">
                Try again
              </button>
            </div>
          ) : history.length === 0 ? (
            <div className="dd-card p-12 text-center border-dashed flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <ImageIcon className="w-8 h-8 text-muted-foreground opacity-50" />
              </div>
              <h3 className="text-lg font-medium mb-1">Your canvas awaits</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                No saved doodles yet. Create a new session, invite a friend, and hit "Save" when you're done drawing to see it here!
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((item) => (
                <div key={item.id} className="dd-card overflow-hidden group">
                  <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                    <img src={item.imageData} alt="doodle" className="w-full h-full object-contain" />
                  </div>
                  <div className="p-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {!item.partnerUsername || item.partnerUsername === "Solo" ? "Solo drawing" : `with ${item.partnerUsername}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()} · {item.sessionCode}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-70 group-hover:opacity-100 transition">
                      <button
                        onClick={() => downloadImage(item)}
                        className="dd-tool-btn !w-8 !h-8"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete(item.id)}
                        className="dd-tool-btn !w-8 !h-8 hover:!text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
