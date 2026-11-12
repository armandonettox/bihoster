import { lazy, Suspense } from "react";
import { useAuth } from "../context/AuthContext";
import PageLoading from "../components/PageLoading";

const Audit = lazy(() => import("./Audit"));

/** Tela de quem pode ver os analiticos mas nao tem acesso a nenhuma colecao: sem a estrutura
 * de colecoes (barra lateral e menus), mostra so o painel de analiticos e o botao Sair. */
export default function AnalyticsOnly() {
  const { user, logout } = useAuth();
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, padding: "12px 24px" }}>
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{user?.name}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Sair
        </button>
      </div>
      <div style={{ padding: "0 24px 24px" }}>
        <Suspense fallback={<PageLoading />}>
          <Audit />
        </Suspense>
      </div>
    </div>
  );
}
