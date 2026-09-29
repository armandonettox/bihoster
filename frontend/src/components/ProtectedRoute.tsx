import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginUrlFor } from "../utils/redirect";
import PageLoading from "./PageLoading";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <PageLoading />;
  }

  if (!user) {
    // Guarda a pagina pedida em ?next= pra voltar pra ela depois do login
    return <Navigate to={loginUrlFor(location.pathname + location.search)} replace />;
  }

  return <>{children}</>;
}
