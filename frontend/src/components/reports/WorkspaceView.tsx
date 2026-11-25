import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractErrorMessage } from "../../api/client";
import type { CatalogItem, ItemKind, ItemSort, ItemsPage, TenantWorkspace } from "../../api/workspaceCatalog";
import * as catalogApi from "../../api/workspaceCatalog";
import { useAccess } from "../../context/AccessContext";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../utils/datetime";
import CatalogSyncModal from "../CatalogSyncModal";
import DatasetSecurityModal from "../DatasetSecurityModal";
import KebabMenu from "../KebabMenu";
import { AvatarStack } from "./Avatar";
import PermissionsPanel from "./PermissionsPanel";
import { BulkShareModal, FoldersModal, HistoryModal } from "./ReportsModals";

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const keyOf = (item: Pick<CatalogItem, "kind" | "id">) => `${item.kind}:${item.id}`;

/** "25/11 12:25": curto para caber numa linha; a data completa fica no title. */
function formatShort(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

function RlsCell({ item }: { item: CatalogItem }) {
  if (item.rls.requires_identity == null && item.rls.role_grants === 0) return <span className="rpt-muted">—</span>;
  if (item.rls.role_grants > 0) {
    return (
      <span title="Cada pessoa precisa de uma função para abrir">
        <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", color: "var(--color-primary-text)" }} aria-hidden="true">shield_lock</span>{" "}
        {item.rls.role_grants} {item.rls.role_grants === 1 ? "função" : "funções"}
      </span>
    );
  }
  return item.rls.requires_identity ? <span title="O modelo tem RLS e nenhuma função foi mapeada aqui">Por usuário</span> : <span className="rpt-muted">Não</span>;
}

/** Dentro de um workspace: relatórios e modelos semânticos numa lista só, no estilo do Power BI Service. Uma ação principal
 * (Sincronizar); as ações de cada linha aparecem ao passar o mouse e no menu "..."; as ações em lote só aparecem quando há
 * seleção. */
export default function WorkspaceView({ workspace, onBack, onChanged }: { workspace: TenantWorkspace; onBack: () => void; onChanged: () => void }) {
  const access = useAccess();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [kind, setKind] = useState<ItemKind>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ItemSort>("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "lineage">("list");
  const [data, setData] = useState<ItemsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, CatalogItem>>(new Map());
  const [panel, setPanel] = useState<CatalogItem | null>(null);
  const [security, setSecurity] = useState<{ id: number; name: string } | null>(null);
  const [folders, setFolders] = useState<CatalogItem[] | null>(null);
  const [history, setHistory] = useState<CatalogItem | null>(null);
  const [bulkShare, setBulkShare] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const debouncedSearch = useDebounced(search, 250);
  const requestId = useRef(0);

  const canSync = access.can("conexao.sincronizar") && workspace.connection_id != null;

  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    const current = ++requestId.current;
    catalogApi
      .listItems({
        connectionId: workspace.connection_id,
        workspace: workspace.pbi_workspace_id,
        kind: view === "lineage" ? "all" : kind,
        search: debouncedSearch,
        sort,
        order,
        pending,
        page: view === "lineage" ? 1 : page,
        pageSize: view === "lineage" ? 100 : PAGE_SIZE,
      })
      .then((result) => {
        if (current !== requestId.current) return;
        setData(result);
        setError(null);
      })
      .catch((err) => current === requestId.current && setError(extractErrorMessage(err) || "Não foi possível carregar os itens."));
  }, [workspace, kind, debouncedSearch, sort, order, pending, page, view, reloadKey]);

  function changed() {
    reload();
    onChanged();
  }

  function sortBy(next: ItemSort) {
    if (sort === next) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setOrder("asc");
    }
    setPage(1);
  }

  function toggle(item: CatalogItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(keyOf(item))) next.delete(keyOf(item));
      else next.set(keyOf(item), item);
      return next;
    });
  }

  const items = data?.items ?? [];
  // A coluna so aparece quando ha dado: uma coluna de tracos so atrapalha
  const hasNext = items.some((i) => i.next_refresh_at);
  const allOnPage = items.length > 0 && items.every((i) => selected.has(keyOf(i)));
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const chosen = useMemo(() => Array.from(selected.values()), [selected]);
  const chosenReports = chosen.filter((i) => i.kind === "report");
  const canBulkShare = chosen.length > 0 && chosen.every((i) => i.can.share);
  const canBulkFolders = chosen.length > 0 && chosenReports.length === chosen.length && chosen.every((i) => i.can.folders);

  async function refresh(item: CatalogItem) {
    try {
      await catalogApi.refreshDataset(item.id);
      showToast("Atualização pedida ao Power BI.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível pedir a atualização.", "error");
    }
  }

  function SortHeader({ id, children }: { id: ItemSort; children: string }) {
    const active = sort === id;
    return (
      <th scope="col" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => sortBy(id)}>
          {children}
          {active ? (order === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  }

  const lineage = useMemo(() => {
    if (view !== "lineage") return [];
    const datasets = items.filter((i) => i.kind === "dataset");
    const reports = items.filter((i) => i.kind === "report");
    const groups = datasets.map((d) => ({ dataset: d as CatalogItem | null, reports: reports.filter((r) => r.dataset_id === d.id) }));
    const orphans = reports.filter((r) => r.dataset_id == null || !datasets.some((d) => d.id === r.dataset_id));
    if (orphans.length > 0) groups.push({ dataset: null, reports: orphans });
    return groups;
  }, [items, view]);

  return (
    <div className="rpt-page">
      <div className="rpt-head">
        <div>
          <button type="button" className="rpt-back" onClick={onBack}>← Workspaces</button>
          <h1>{workspace.name}</h1>
          <div className="rpt-sub">
            {workspace.connection_name ? `${workspace.connection_name} · ` : ""}
            {workspace.reports} {workspace.reports === 1 ? "relatório" : "relatórios"} · {workspace.datasets} {workspace.datasets === 1 ? "modelo" : "modelos"}
            {workspace.last_synced_at ? ` · sincronizado em ${formatShort(workspace.last_synced_at)}` : " · ainda não sincronizado"}
          </div>
        </div>
        {canSync && (
          <button type="button" className="btn btn-primary" onClick={() => setSyncing(true)}>Sincronizar</button>
        )}
      </div>

      <div className="rpt-toolbar">
        <div className="rpt-seg" role="group" aria-label="Tipo">
          {([["all", "Todos"], ["report", "Relatórios"], ["dataset", "Modelos semânticos"]] as [ItemKind, string][]).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={kind === key} disabled={view === "lineage"} onClick={() => { setKind(key); setPage(1); }}>{label}</button>
          ))}
        </div>
        <input className="input rpt-search" type="search" aria-label="Buscar" placeholder="Buscar por nome" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {data && data.pending_total > 0 && (
          <button type="button" className="rpt-chip" aria-pressed={pending} onClick={() => { setPending((p) => !p); setPage(1); }}>
            <span className="rpt-dot" aria-hidden="true" />
            {data.pending_total} {data.pending_total === 1 ? "novo sem acesso" : "novos sem acesso"}
          </button>
        )}
        <div className="rpt-seg" role="group" aria-label="Visualização" style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>Lista</button>
          <button type="button" aria-pressed={view === "lineage"} onClick={() => setView("lineage")}>Linhagem</button>
        </div>
      </div>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {!data && !error && (
        <div aria-label="Carregando" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="rpt-skel" />)}
        </div>
      )}

      {data && view === "list" && items.length === 0 && (
        <div className="rpt-empty">
          <h3>{debouncedSearch || pending || kind !== "all" ? "Nada encontrado" : "Este workspace está vazio"}</h3>
          <p style={{ margin: "0 0 12px" }}>
            {debouncedSearch || pending || kind !== "all"
              ? "Tente outro filtro ou limpe a busca."
              : canSync ? "Sincronize para trazer os relatórios e modelos do tenant." : "Ainda não há nada aqui para você."}
          </p>
          {(debouncedSearch || pending || kind !== "all") && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSearch(""); setPending(false); setKind("all"); }}>Limpar filtros</button>
          )}
          {!(debouncedSearch || pending || kind !== "all") && canSync && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSyncing(true)}>Sincronizar agora</button>
          )}
        </div>
      )}

      {data && view === "list" && items.length > 0 && (
        <div className="rpt-table-wrap">
          <table className="rpt-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 34 }}>
                  <input type="checkbox" aria-label="Selecionar todos desta página" checked={allOnPage} onChange={() => setSelected((prev) => {
                    const next = new Map(prev);
                    items.forEach((i) => (allOnPage ? next.delete(keyOf(i)) : next.set(keyOf(i), i)));
                    return next;
                  })} />
                </th>
                <SortHeader id="name">Nome</SortHeader>
                <SortHeader id="kind">Tipo</SortHeader>
                <th scope="col">Pastas</th>
                <SortHeader id="updated">Atualizado</SortHeader>
                {hasNext && <th scope="col">Próxima atualização</th>}
                <SortHeader id="access">Acesso</SortHeader>
                <th scope="col">RLS</th>
                <th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isSelected = selected.has(keyOf(item));
                const securityId = item.kind === "dataset" ? (item.can.security ? item.id : null) : item.dataset_id != null && access.can("modelo.seguranca") ? item.dataset_id : null;
                return (
                  <tr key={keyOf(item)} data-selected={isSelected}>
                    <td><input type="checkbox" aria-label={`Selecionar ${item.name}`} checked={isSelected} onChange={() => toggle(item)} /></td>
                    <td>
                      <div className="rpt-name">
                        <span className="material-symbols-outlined" aria-hidden="true">{item.kind === "report" ? "bar_chart" : "database"}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
                        {item.pending && <span className="rpt-new">Novo</span>}
                        {item.missing && <span className="rpt-new" style={{ color: "#b91c1c", background: "#fee2e2" }}>Não encontrado</span>}
                      </div>
                    </td>
                    <td>{item.kind === "report" ? "Relatório" : "Modelo semântico"}</td>
                    <td>{item.kind === "dataset" ? <span className="rpt-muted">{item.reports_count ?? 0} {(item.reports_count ?? 0) === 1 ? "relatório" : "relatórios"}</span> : item.folders.length > 0 ? item.folders.join(", ") : <span className="rpt-muted">Só no catálogo</span>}</td>
                    <td>
                      {item.last_refresh_at ? (
                        <span title={`Última atualização dos dados: ${formatDateTime(item.last_refresh_at)}${item.last_refresh_status ? ` (${item.last_refresh_status})` : ""}`}>{formatShort(item.last_refresh_at)}</span>
                      ) : item.updated_at ? (
                        <span className="rpt-muted" title={`Sincronizado em ${formatDateTime(item.updated_at)}`}>{formatShort(item.updated_at)}</span>
                      ) : (
                        <span className="rpt-muted">—</span>
                      )}
                    </td>
                    {hasNext && <td>{item.next_refresh_at ? <span title={formatDateTime(item.next_refresh_at)}>{formatShort(item.next_refresh_at)}</span> : <span className="rpt-muted">—</span>}</td>}
                    <td><AvatarStack people={item.access.people} count={item.access.count} /></td>
                    <td><RlsCell item={item} /></td>
                    <td>
                      <div className="rpt-actions">
                        {item.kind === "report" && item.can.open && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/collection/${item.collection_id}/report/${item.id}`)}>Abrir</button>
                        )}
                        {item.can.share && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel(item)}>Compartilhar</button>}
                        <KebabMenu floating>
                          {(close) => (
                            <>
                              {item.can.share && <button className="kebab-menu-item" onClick={() => { close(); setPanel(item); }}>Gerenciar permissões</button>}
                              {securityId != null && <button className="kebab-menu-item" onClick={() => { close(); setSecurity({ id: securityId, name: item.kind === "dataset" ? item.name : item.dataset_name ?? item.name }); }}>Segurança dos dados</button>}
                              {item.kind === "report" && item.can.folders && <button className="kebab-menu-item" onClick={() => { close(); setFolders([item]); }}>Pastas</button>}
                              {item.kind === "dataset" && item.can.refresh && <button className="kebab-menu-item" onClick={() => { close(); void refresh(item); }}>Atualizar agora</button>}
                              {item.kind === "dataset" && item.can.history && <button className="kebab-menu-item" onClick={() => { close(); setHistory(item); }}>Histórico de atualização</button>}
                              {!item.can.share && securityId == null && !item.can.folders && !item.can.refresh && !item.can.history && <span className="kebab-menu-item rpt-muted">Sem ações para você</span>}
                            </>
                          )}
                        </KebabMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && view === "list" && data.total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12 }}>
          <span className="rpt-muted" style={{ fontSize: 13 }}>{data.total} itens · página {data.page} de {pageCount}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      )}

      {data && view === "lineage" && (
        <div className="rpt-lineage">
          {lineage.length === 0 && <div className="rpt-empty"><h3>Nada para mostrar</h3></div>}
          {lineage.map((group, index) => (
            <div key={group.dataset?.id ?? `sem-${index}`} className="rpt-lineage-card">
              <div className="rpt-name">
                <span className="material-symbols-outlined" aria-hidden="true">{group.dataset ? "database" : "link_off"}</span>
                {group.dataset ? group.dataset.name : "Relatórios sem modelo conhecido"}
                {group.dataset && <span className="rpt-muted" style={{ fontWeight: 400 }}>· <RlsCell item={group.dataset} /></span>}
              </div>
              <ul>
                {group.reports.length === 0 && <li className="rpt-muted">Nenhum relatório usa este modelo</li>}
                {group.reports.map((report) => (
                  <li key={report.id} className="rpt-name" style={{ fontWeight: 500 }}>
                    <span className="material-symbols-outlined" aria-hidden="true">bar_chart</span>{report.name}
                    <AvatarStack people={report.access.people} count={report.access.count} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {data.total > 100 && <p className="rpt-muted">Mostrando os primeiros 100 itens. Use a busca para achar os outros.</p>}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="rpt-bulk" role="region" aria-label="Ações em lote">
          <strong>{chosen.length} {chosen.length === 1 ? "selecionado" : "selecionados"}</strong>
          {canBulkShare && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBulkShare(true)}>Compartilhar</button>}
          {canBulkFolders && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFolders(chosenReports)}>Pastas</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Map())}>Limpar</button>
        </div>
      )}

      {panel && <PermissionsPanel kind={panel.kind} itemId={panel.id} itemName={panel.name} onClose={() => setPanel(null)} onChanged={changed} />}
      {security && <DatasetSecurityModal datasetId={security.id} datasetName={security.name} onClose={() => setSecurity(null)} onSaved={changed} />}
      {folders && <FoldersModal reports={folders} onClose={() => setFolders(null)} onDone={() => { setSelected(new Map()); changed(); }} />}
      {history && <HistoryModal datasetId={history.id} name={history.name} onClose={() => setHistory(null)} />}
      {bulkShare && <BulkShareModal items={chosen} onClose={() => setBulkShare(false)} onDone={() => { setSelected(new Map()); changed(); }} />}
      {syncing && workspace.connection_id != null && (
        <CatalogSyncModal
          connection={{ id: workspace.connection_id, name: workspace.connection_name ?? "Conta", tenant_id: "", client_id: "", client_secret_configured: true }}
          onClose={() => setSyncing(false)}
          onFinished={changed}
        />
      )}
    </div>
  );
}
