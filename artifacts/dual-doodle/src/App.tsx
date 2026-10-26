import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Dashboard from "@/pages/Dashboard";
import Room from "@/pages/Room";
import NotFound from "@/pages/not-found";
import { Loader2 } from "@/lib/lucide-icons";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  if (loading) {
    return (
      <div className="dd-bg-gradient min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    sessionStorage.setItem("dd_redirect", location);
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/dashboard" />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Redirect to={user ? "/dashboard" : "/login"} />;
}

function Routes() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login">
        <GuestOnly>
          <Login />
        </GuestOnly>
      </Route>
      <Route path="/signup">
        <GuestOnly>
          <Signup />
        </GuestOnly>
      </Route>
      <Route path="/dashboard">
        <Protected>
          <Dashboard />
        </Protected>
      </Route>
      <Route path="/room/:code">
        <Protected>
          <Room />
        </Protected>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Routes />
        </WouterRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
