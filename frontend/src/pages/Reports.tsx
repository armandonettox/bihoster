import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { extractErrorMessage } from "../api/client";
import type { TenantWorkspace } from "../api/workspaceCatalog";
import * as catalogApi from "../api/workspaceCatalog";
import PageLoading from "../components/PageLoading";
import WorkspaceView from "../components/reports/WorkspaceView";
import { useAccess } from "../context/AccessContext";
import { REPORTS_AREA_KEYS } from "../utils/adminTabs";


function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** "25/11 12:25": curto para caber numa linha. */
function formatShort(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

const wsKey = (w: Pick<TenantWorkspace, "connection_id" | "pbi_workspace_id">) => `${w.connection_id ?? 0}~${w.pbi_workspace_id}`;

/** Módulo Relatórios: a entrada é a lista de workspaces do tenant (como no Power BI Service); ao abrir um, aparecem os
 * relatórios e modelos semânticos dele. Une o antigo Catálogo e a tela de acessos aos relatórios. */
export default function Reports() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<TenantWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);
  const selectedKey = params.get("ws");

  const load = useCallback(() => {
    catalogApi
      .listTenantWorkspaces(debounced)
      .then((list) => {
        setWorkspaces(list);
        setError(null);
      })
      .catch((err) => setError(extractErrorMessage(err) || "Não foi possível carregar os workspaces."));
  }, [debounced]);

  useEffect(() => {
    load();
  }, [load]);

  if (access.loading) return <PageLoading />;
  // Quem so recebeu itens soltos tambem entra: a lista dela vem filtrada pelo servidor
  if (!access.canAny(...REPORTS_AREA_KEYS) && !access.hasItemGrants) return <Navigate to="/" replace />;

  const selected = workspaces?.find((w) => wsKey(w) === selectedKey) ?? null;
  if (selectedKey && workspaces && !selected && !debounced) {
    // O workspace do endereco nao existe mais (ou a pessoa nao o ve): volta para a lista
    return <Navigate to="/catalog" replace />;
  }
  if (selected) {
    return <WorkspaceView workspace={selected} onBack={() => setParams({}, { replace: false })} onChanged={load} />;
  }

  const totalPending = (workspaces ?? []).reduce((sum, w) => sum + w.pending, 0);

  return (
    <div className="rpt-page">
      <div className="rpt-head">
        <div>
          <h1>Relatórios</h1>
          <div className="rpt-sub">Os workspaces do tenant do Power BI. Abra um para ver os relatórios e os modelos dele.</div>
        </div>
        {totalPending > 0 && (
          <span className="rpt-chip" aria-label={`${totalPending} relatórios novos sem acesso`}>
            <span className="rpt-dot" aria-hidden="true" />
            {totalPending} {totalPending === 1 ? "novo sem acesso" : "novos sem acesso"}
          </span>
        )}
      </div>
      <div className="rpt-toolbar">
        <input className="input rpt-search" type="search" aria-label="Buscar workspace" placeholder="Buscar workspace" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {!workspaces && !error && (
        <div aria-label="Carregando" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="rpt-skel" />)}
        </div>
      )}
      {workspaces && workspaces.length === 0 && (
        <div className="rpt-empty">
          <h3>{debounced ? "Nenhum workspace encontrado" : "Nada importado ainda"}</h3>
          <p style={{ margin: "0 0 12px" }}>
            {debounced
              ? "Tente outro nome."
              : access.can("conexao.sincronizar") ? "Sincronize uma conta do Power BI para trazer os workspaces, relatórios e modelos do tenant." : "Quando alguém compartilhar um relatório ou um modelo com você, ele aparece aqui."}
          </p>
          {!debounced && access.can("conexao.sincronizar") && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/settings")}>Ir para as contas do Power BI</button>
          )}
        </div>
      )}
      {workspaces && workspaces.length > 0 && (
        <div className="rpt-list">
          {workspaces.map((w) => (
            <button key={wsKey(w)} type="button" className="rpt-ws-row" onClick={() => setParams({ ws: wsKey(w) })}>
              <span className="rpt-ws-icon" aria-hidden="true"><span className="material-symbols-outlined">workspaces</span></span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: "block" }}>{w.name}</span>
                <span className="rpt-sub">{w.connection_name ?? ""}{w.last_synced_at ? ` · sincronizado em ${formatShort(w.last_synced_at)}` : " · ainda não sincronizado"}</span>
              </span>
              <span className="rpt-sub" style={{ textAlign: "right" }}>
                {w.reports} {w.reports === 1 ? "relatório" : "relatórios"}<br />{w.datasets} {w.datasets === 1 ? "modelo" : "modelos"}
              </span>
              <span style={{ minWidth: 90, textAlign: "right" }}>
                {w.pending > 0 && <span className="rpt-chip"><span className="rpt-dot" aria-hidden="true" />{w.pending} {w.pending === 1 ? "novo" : "novos"}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
