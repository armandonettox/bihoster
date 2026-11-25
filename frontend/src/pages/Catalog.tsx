import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import * as catalogApi from "../api/catalog";
import type { CatalogDataset, CatalogReport, CatalogState, CatalogWhere, Page } from "../api/catalog";
import { extractErrorMessage } from "../api/client";
import PageLoading from "../components/PageLoading";
import { SkeletonList } from "../components/Skeleton";
import { useAccess } from "../context/AccessContext";
import { CATALOG_AREA_KEYS } from "../utils/adminTabs";
import { formatDateTime } from "../utils/datetime";

const PAGE_SIZE = 25;

type CatalogTab = "reports" | "datasets";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function StateBadge({ missingAt }: { missingAt: string | null }) {
  if (!missingAt) return <span style={{ color: "var(--color-text-muted)" }}>No Power BI</span>;
  return (
    <span style={{ color: "var(--color-danger, #b3261e)", fontWeight: 600 }} title={`Deixou de aparecer em ${formatDateTime(missingAt)}`}>
      Não encontrado
    </span>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (next: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12 }}>
      <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
        {total} {total === 1 ? "item" : "itens"} · página {page} de {pages}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </div>
  );
}

function Filters({
  origins,
  search,
  workspace,
  state,
  where,
  onSearch,
  onWorkspace,
  onState,
  onWhere,
}: {
  origins: string[];
  search: string;
  workspace: string;
  state: CatalogState;
  where?: CatalogWhere;
  onSearch: (v: string) => void;
  onWorkspace: (v: string) => void;
  onState: (v: CatalogState) => void;
  onWhere?: (v: CatalogWhere) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <input
        className="input"
        style={{ flex: "1 1 220px" }}
        type="search"
        placeholder="Buscar por nome ou workspace"
        aria-label="Buscar"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <select className="input" style={{ flex: "0 1 220px" }} aria-label="Workspace de origem" value={workspace} onChange={(e) => onWorkspace(e.target.value)}>
        <option value="">Todos os workspaces</option>
        {origins.map((origin) => (
          <option key={origin} value={origin}>
            {origin}
          </option>
        ))}
      </select>
      <select className="input" style={{ flex: "0 1 180px" }} aria-label="Estado" value={state} onChange={(e) => onState(e.target.value as CatalogState)}>
        <option value="all">Qualquer estado</option>
        <option value="ok">Encontrados</option>
        <option value="missing">Não encontrados</option>
      </select>
      {onWhere && where !== undefined && (
        <select className="input" style={{ flex: "0 1 180px" }} aria-label="Onde está" value={where} onChange={(e) => onWhere(e.target.value as CatalogWhere)}>
          <option value="all">Raiz e coleções</option>
          <option value="root">Só na Raiz</option>
          <option value="collections">Só em coleções</option>
        </select>
      )}
    </div>
  );
}

function ReportsList({ origins }: { origins: string[] }) {
  const [search, setSearch] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [state, setState] = useState<CatalogState>("all");
  const [where, setWhere] = useState<CatalogWhere>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<CatalogReport> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .listCatalogReports({ search: debouncedSearch, workspace, state, where, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err) || "Não foi possível carregar o catálogo.");
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, workspace, state, where, page]);

  function change<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <>
      <Filters
        origins={origins}
        search={search}
        workspace={workspace}
        state={state}
        where={where}
        onSearch={change(setSearch)}
        onWorkspace={change(setWorkspace)}
        onState={change(setState)}
        onWhere={change(setWhere)}
      />
      {error && <p className="auth-error">{error}</p>}
      {!data && !error ? (
        <SkeletonList count={4} />
      ) : data && data.items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          Nenhum relatório encontrado. Para importar os do tenant, use Sincronizar em Administração, Contas do Power BI.
        </p>
      ) : data ? (
        <>
          <div className="audit-table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Relatório</th>
                  <th scope="col">Workspace de origem</th>
                  <th scope="col">Onde está</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Última sincronização</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((report) => (
                  <tr key={report.id}>
                    <td>
                      {report.name}
                      {report.source !== "sync" && <span style={{ marginLeft: 6, fontSize: 12, color: "var(--color-text-muted)" }}>(cadastrado à mão)</span>}
                    </td>
                    <td>{report.pbi_workspace_name ?? report.pbi_workspace_id}</td>
                    <td>{report.in_root ? "Raiz" : report.collection_name}</td>
                    <td>
                      <StateBadge missingAt={report.sync_missing_at} />
                    </td>
                    <td>{report.synced_at ? formatDateTime(report.synced_at) : "nunca"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </>
  );
}

function DatasetsList({ origins }: { origins: string[] }) {
  const [search, setSearch] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [state, setState] = useState<CatalogState>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<CatalogDataset> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .listCatalogDatasets({ search: debouncedSearch, workspace, state, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err) || "Não foi possível carregar os modelos.");
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, workspace, state, page]);

  function change<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <>
      <Filters
        origins={origins}
        search={search}
        workspace={workspace}
        state={state}
        onSearch={change(setSearch)}
        onWorkspace={change(setWorkspace)}
        onState={change(setState)}
      />
      {error && <p className="auth-error">{error}</p>}
      {!data && !error ? (
        <SkeletonList count={4} />
      ) : data && data.items.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhum modelo semântico encontrado.</p>
      ) : data ? (
        <>
          <div className="audit-table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Modelo</th>
                  <th scope="col">Workspace de origem</th>
                  <th scope="col">Relatórios que usam</th>
                  <th scope="col">Segurança por linha</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>{dataset.name}</td>
                    <td>{dataset.pbi_workspace_name ?? dataset.pbi_workspace_id}</td>
                    <td>{dataset.reports_count}</td>
                    <td>{dataset.requires_identity === null ? "Não informado" : dataset.requires_identity ? "Exige identidade (RLS)" : "Não"}</td>
                    <td>
                      <StateBadge missingAt={dataset.sync_missing_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </>
  );
}

/** Catalogo do Power BI: tudo o que o portal conhece do tenant, mesmo o que ninguem recebeu acesso ainda. A lista de
 * relatorios e a de modelos semanticos tem cada uma a sua permissao; nenhuma das duas da acesso ao conteudo. */
export default function Catalog() {
  const access = useAccess();
  const canReports = access.can("relatorio.catalogo");
  const canDatasets = access.can("modelo.catalogo");
  const [tab, setTab] = useState<CatalogTab>(canReports ? "reports" : "datasets");
  const [origins, setOrigins] = useState<string[]>([]);

  useEffect(() => {
    if (!canReports) return;
    catalogApi.listCatalogOrigins().then(setOrigins).catch(() => setOrigins([]));
  }, [canReports]);

  if (access.loading) return <PageLoading />;
  if (!access.canAny(...CATALOG_AREA_KEYS)) return <Navigate to="/" replace />;

  const activeTab: CatalogTab = tab === "reports" && !canReports ? "datasets" : tab === "datasets" && !canDatasets ? "reports" : tab;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Catálogo do Power BI</h1>
        <p>O que existe no tenant e já foi importado para a Raiz. Importar não dá acesso a ninguém: o acesso é uma permissão à parte.</p>
      </div>
      {canReports && canDatasets && (
        <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button role="tab" aria-selected={activeTab === "reports"} className={`btn btn-sm ${activeTab === "reports" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("reports")}>
            Relatórios
          </button>
          <button role="tab" aria-selected={activeTab === "datasets"} className={`btn btn-sm ${activeTab === "datasets" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("datasets")}>
            Modelos semânticos
          </button>
        </div>
      )}
      {activeTab === "reports" ? <ReportsList origins={origins} /> : <DatasetsList origins={origins} />}
    </div>
  );
}
