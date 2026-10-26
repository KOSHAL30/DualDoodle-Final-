import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearAuth, getStoredUser, getToken, setAuth, type AuthUser } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  // Cached user data is only a display hint. Do not expose protected routes until
  // the server has confirmed that the stored token is still valid.
  const [loading, setLoading] = useState<boolean>(!!getToken());

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        localStorage.setItem("dd_user", JSON.stringify(user));
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (identifier: string, password: string) => {
    const { token, user } = await api.login({ identifier, password });
    setAuth(token, user);
    setUser(user);
  };

  const signup = async (username: string, email: string, password: string) => {
    const { token, user } = await api.signup({ username, email, password });
    setAuth(token, user);
    setUser(user);
  };

  const logout = () => {
    clearAuth();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
