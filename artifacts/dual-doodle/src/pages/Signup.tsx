import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { consumePostAuthRedirect } from "@/lib/auth-redirect";
import { Palette, Loader2 } from "@/lib/lucide-icons";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Signup() {
  const { signup } = useAuth();
  const [, navigate] = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signup(username, email, password);
      navigate(consumePostAuthRedirect());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="dd-page-enter dd-bg-gradient min-h-screen flex items-center justify-center p-6 relative"
    >
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <div className="dd-card p-8 w-full max-w-md canvas-shadow">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-3">
            <Palette className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">Start drawing with a friend in seconds.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="signup-username" className="text-sm font-medium block mb-1.5">Username</label>
            <input
              id="signup-username"
              type="text"
              required
              minLength={2}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="signup-email" className="text-sm font-medium block mb-1.5">Email</label>
            <input
              id="signup-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="text-sm font-medium block mb-1.5">Password</label>
            <input
              id="signup-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground mt-1">At least 6 characters.</p>
          </div>
          {error && (
            <div role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>
        </form>
        <p className="text-sm text-center text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
