import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as authApi from "../api/auth";
import type { User } from "../api/auth";
import { safeStorage } from "../utils/safeStorage";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// O token dura 60 min; renova bem antes disso. Sem renovacao a TV e qualquer aba aberta caiam
// depois de uma hora.
const REFRESH_EVERY_MS = 20 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRefreshRef = useRef(Date.now());

  // Sessao deslizante: enquanto ha usuario logado, troca o token periodicamente.
  useEffect(() => {
    if (!user) return;
    lastRefreshRef.current = Date.now();

    async function refresh() {
      try {
        const token = await authApi.refreshSession();
        safeStorage.setItem("token", token);
        lastRefreshRef.current = Date.now();
      } catch {
        // Falha de rede: tenta de novo no proximo ciclo. Se foi 401 (sessao vencida, senha
        // trocada), o interceptor do axios ja cuida de mandar pro login.
      }
    }

    const timer = setInterval(refresh, REFRESH_EVERY_MS);
    // Timers ficam pra tras quando o computador dorme ou a aba fica em segundo plano: ao voltar,
    // renova na hora se ja passou do ciclo.
    function handleVisibility() {
      if (document.visibilityState === "visible" && Date.now() - lastRefreshRef.current >= REFRESH_EVERY_MS) {
        refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user]);

  useEffect(() => {
    const token = safeStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => safeStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const token = await authApi.login(email, password);
    safeStorage.setItem("token", token);
    const currentUser = await authApi.me();
    setUser(currentUser);
  }

  async function loginWithGoogle(idToken: string) {
    const token = await authApi.loginWithGoogle(idToken);
    safeStorage.setItem("token", token);
    const currentUser = await authApi.me();
    setUser(currentUser);
  }

  function logout() {
    safeStorage.removeItem("token");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa ser usado dentro de um AuthProvider");
  }
  return context;
}
