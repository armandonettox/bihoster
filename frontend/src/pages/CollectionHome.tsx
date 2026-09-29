import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import * as reportsApi from "../api/reports";
import * as workspacesApi from "../api/workspaces";
import * as homeApi from "../api/home";
import { useFavorites } from "../context/FavoritesContext";
import type { DisplayType, Report } from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import NewReportForm from "../components/NewReportForm";
import ReportEmbed from "../components/ReportEmbed";
import ReportThumbnail from "../components/ReportThumbnail";
import FullscreenReportView from "../components/FullscreenReportView";
import EditCollectionModal from "../components/EditCollectionModal";
import KebabMenu from "../components/KebabMenu";
import ReorderButtons from "../components/ReorderButtons";
import ListFilter from "../components/ListFilter";
import { filterByName } from "../utils/filterByName";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "../components/ConfirmDialog";
import ReportRefreshInfo from "../components/ReportRefreshInfo";
import LazyMount from "../components/LazyMount";
import { safeStorage } from "../utils/safeStorage";
import { extractErrorMessage } from "../api/client";

const SECTION_TITLES: Record<DisplayType, string> = {
  relatorio: "Relatorios",
  painel: "Painel",
  apresentacao: "Apresentacao",
  tv: "Modo TV",
};

type ViewMode = "list" | "icon";
const VIEW_MODE_KEY = "collection_view_mode";

export default function CollectionHome() {
  const { currentWorkspace, reload: reloadWorkspaces } = useWorkspace();

  const [reports, setReports] = useState<Report[]>([]);
  const [activeReportId, setActiveReportId] = useState<number | null>(null);
  const [mountedReportIds, setMountedReportIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creatingReport, setCreatingReport] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [editingCollection, setEditingCollection] = useState(false);
  const [confirmingDeleteReportId, setConfirmingDeleteReportId] = useState<number | null>(null);
  const [fullscreenSection, setFullscreenSection] = useState<"apresentacao" | "tv" | null>(null);
  const [fullscreenReportId, setFullscreenReportId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (safeStorage.getItem(VIEW_MODE_KEY) as ViewMode) || "list"
  );
  const [tvIntervalDraft, setTvIntervalDraft] = useState("15");
  const [movingReportId, setMovingReportId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const { favoriteIds, toggleFavorite } = useFavorites();

  useEffect(() => {
    if (currentWorkspace) setTvIntervalDraft(String(currentWorkspace.tv_interval_seconds));
  }, [currentWorkspace?.id, currentWorkspace?.tv_interval_seconds]);

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    safeStorage.setItem(VIEW_MODE_KEY, mode);
  }

  function toggleActiveReport(reportId: number) {
    setActiveReportId((current) => (current === reportId ? null : reportId));
    setMountedReportIds((current) => (current.has(reportId) ? current : new Set(current).add(reportId)));
  }

  const role = currentWorkspace?.role;
  const canWrite = role === "admin" || role === "editor";
  const isAdmin = role === "admin";
  const { showToast } = useToast();

  // Os efeitos abaixo dependem so do id da colecao, nao do objeto: o reload do WorkspaceContext
  // cria um objeto novo a cada chamada (ex: ao mudar o intervalo da TV ou editar a colecao), e
  // depender do objeto resetava a pagina inteira e registrava a visita em "Recentes" de novo.
  const workspaceId = currentWorkspace?.id;

  // O filtro e da colecao aberta: ao trocar de colecao, comeca limpo
  useEffect(() => {
    setFilter("");
  }, [workspaceId]);

  const loadRequestIdRef = useRef(0);
  const loadReports = useCallback(async () => {
    if (workspaceId === undefined) return;
    const requestId = ++loadRequestIdRef.current;
    const data = await reportsApi.listReports(workspaceId);
    // Ignora respostas de uma colecao/pedido antigo que chegaram depois de um mais recente --
    // evita mostrar os relatorios da colecao errada ao trocar de colecao rapidamente.
    if (requestId !== loadRequestIdRef.current) return;
    setReports(data);
  }, [workspaceId]);

  // Recarrega a lista apos criar/editar/excluir; se falhar, avisa em vez de deixar a promise
  // sem tratamento (rejeicao nao capturada) com a lista velha na tela.
  const refreshReports = useCallback(async () => {
    try {
      await loadReports();
    } catch {
      showToast("Nao foi possivel atualizar a lista de relatorios.", "error");
    }
  }, [loadReports, showToast]);

  useEffect(() => {
    if (workspaceId === undefined) return;
    homeApi.recordCollectionView(workspaceId).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    setActiveReportId(null);
    setMountedReportIds(new Set());
    setFullscreenSection(null);
    setFullscreenReportId(null);
    loadReports()
      .catch(() => showToast("Nao foi possivel carregar os relatorios desta colecao.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReports]);

  useEffect(() => {
    if (!fullscreenReportId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreenReportId(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenReportId]);

  async function handleDeleteReport(reportId: number) {
    if (!currentWorkspace) return;
    try {
      await reportsApi.deleteReport(currentWorkspace.id, reportId);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir o relatorio.", "error");
      return;
    }
    if (activeReportId === reportId) setActiveReportId(null);
    setMountedReportIds((current) => {
      if (!current.has(reportId)) return current;
      const next = new Set(current);
      next.delete(reportId);
      return next;
    });
    // O servidor ja confirmou: tira da lista na hora, sem esperar uma segunda ida a rede, e
    // recarrega em segundo plano so pra alinhar com o servidor.
    setReports((current) => current.filter((r) => r.id !== reportId));
    showToast("Relatorio excluido.");
    refreshReports();
  }

  async function handleTvIntervalCommit(rawValue: string) {
    if (!currentWorkspace) return;
    const parsed = Number(rawValue);
    // So envia ao backend quando o valor digitado for um numero valido dentro do intervalo
    // permitido -- evita gravar 0 (ou lixo) momentaneamente enquanto o campo esta sendo editado.
    const seconds = Number.isFinite(parsed) ? Math.min(3600, Math.max(3, Math.round(parsed))) : currentWorkspace.tv_interval_seconds;
    setTvIntervalDraft(String(seconds));
    if (seconds === currentWorkspace.tv_interval_seconds) return;
    try {
      await workspacesApi.updateWorkspace(currentWorkspace.id, { tv_interval_seconds: seconds });
      await reloadWorkspaces();
    } catch (err: any) {
      // Volta o campo pro valor que realmente esta salvo, em vez de mostrar um valor que nao foi gravado
      setTvIntervalDraft(String(currentWorkspace.tv_interval_seconds));
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar o intervalo da TV.", "error");
    }
  }

  // Sobe/desce um relatorio dentro da secao. O servidor devolve a lista ja reordenada, entao a
  // tela usa essa resposta em vez de adivinhar a nova ordem; enquanto isso os botoes ficam
  // bloqueados pra um clique duplo nao mandar dois movimentos seguidos.
  async function handleMoveReport(report: Report, direction: "up" | "down") {
    if (!currentWorkspace || movingReportId !== null) return;
    setMovingReportId(report.id);
    try {
      setReports(await reportsApi.moveReport(currentWorkspace.id, report.id, direction));
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel mudar a ordem do relatorio.", "error");
    } finally {
      setMovingReportId(null);
    }
  }

  if (!currentWorkspace) return null;

  const relatorioReports = reports.filter((r) => r.display_type === "relatorio");
  const painelReports = reports.filter((r) => r.display_type === "painel");
  const apresentacaoReports = reports.filter((r) => r.display_type === "apresentacao");
  const tvReports = reports.filter((r) => r.display_type === "tv");

  // O filtro so vale pro que aparece na pagina. A exibicao em tela cheia (TV e Apresentacao) usa
  // as listas completas acima: filtrar a pagina nao pode mudar o que passa na TV.
  const filtering = filter.trim() !== "";
  const shownRelatorio = filterByName(relatorioReports, filter, (r) => r.name);
  const shownPainel = filterByName(painelReports, filter, (r) => r.name);
  const shownApresentacao = filterByName(apresentacaoReports, filter, (r) => r.name);
  const shownTv = filterByName(tvReports, filter, (r) => r.name);
  const shownTotal = shownRelatorio.length + shownPainel.length + shownApresentacao.length + shownTv.length;

  if (fullscreenSection) {
    return (
      <FullscreenReportView
        mode={fullscreenSection}
        collectionName={currentWorkspace.name}
        reports={fullscreenSection === "apresentacao" ? apresentacaoReports : tvReports}
        tvIntervalSeconds={currentWorkspace.tv_interval_seconds}
        onExit={() => setFullscreenSection(null)}
      />
    );
  }

  const fullscreenReport = fullscreenReportId ? reports.find((r) => r.id === fullscreenReportId) : null;
  if (fullscreenReport) {
    return (
      <div className="fullscreen-view">
        <div className="fullscreen-view-header">
          <div>
            <span style={{ fontWeight: 700 }}>{currentWorkspace.name}</span>
            <span style={{ color: "var(--color-text-muted)", marginLeft: 10 }}>{fullscreenReport.name}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setFullscreenReportId(null)}>
            Sair (Esc)
          </button>
        </div>
        <div className="fullscreen-view-body">
          <ReportEmbed key={fullscreenReport.id} reportId={fullscreenReport.id} height="100%" />
        </div>
      </div>
    );
  }

  function viewModeToggle() {
    return (
      <div style={{ display: "flex", gap: 2 }}>
        <button
          className={`btn btn-ghost btn-sm ${viewMode === "list" ? "btn-ghost-active" : ""}`}
          onClick={() => changeViewMode("list")}
          title="Ver como lista"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            view_list
          </span>
        </button>
        <button
          className={`btn btn-ghost btn-sm ${viewMode === "icon" ? "btn-ghost-active" : ""}`}
          onClick={() => changeViewMode("icon")}
          title="Ver como icones"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            grid_view
          </span>
        </button>
      </div>
    );
  }

  function iconGrid(sectionReports: Report[]) {
    return (
      <div className="report-icon-grid" style={{ marginBottom: 20 }}>
        {sectionReports.map((report) => (
          <div
            key={report.id}
            className="card report-icon-card"
            role="button"
            tabIndex={0}
            onClick={() => setFullscreenReportId(report.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFullscreenReportId(report.id);
              }
            }}
          >
            <div className="report-icon-card-preview">
              <LazyMount placeholder={<div className="skeleton report-icon-card-preview-skeleton" />}>
                <ReportThumbnail reportId={report.id} />
              </LazyMount>
              <div className="report-icon-card-overlay">
                <span className="material-symbols-outlined">fullscreen</span>
              </div>
            </div>
            <div className="report-icon-card-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{report.name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  {reorderControls(report, sectionReports)}
                  {reportActionsMenu(report)}
                </div>
              </div>
              <ReportRefreshInfo workspaceId={currentWorkspace!.id} reportId={report.id} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // A ordem so importa (e so pode ser mudada) no Modo TV e na Apresentacao, onde ela define a
  // sequencia de exibicao, e so por quem pode editar.
  function reorderControls(report: Report, sectionReports: Report[]) {
    // Com filtro a secao mostrada e so uma parte: "subir" pareceria pular itens escondidos, porque
    // o servidor troca com o vizinho da secao completa. Limpe o filtro pra reordenar.
    if (!canWrite || filter.trim() !== "" || sectionReports.length < 2) return null;
    if (report.display_type !== "tv" && report.display_type !== "apresentacao") return null;
    const index = sectionReports.findIndex((r) => r.id === report.id);
    return (
      <ReorderButtons
        name={report.name}
        canMoveUp={index > 0}
        canMoveDown={index >= 0 && index < sectionReports.length - 1}
        busy={movingReportId !== null}
        onMove={(direction) => handleMoveReport(report, direction)}
      />
    );
  }

  function reportActionsMenu(report: Report) {
    const isFavorite = favoriteIds.has(report.id);
    return (
      <KebabMenu>
        {(close) => (
          <>
            <button
              className="kebab-menu-item"
              onClick={() => {
                close();
                toggleFavorite(report.id, report);
              }}
            >
              {isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            </button>
            {canWrite && (
              <button
                className="kebab-menu-item"
                onClick={() => {
                  close();
                  setEditingReport(report);
                }}
              >
                Editar
              </button>
            )}
            {canWrite && (
              <button
                className="kebab-menu-item kebab-menu-item-danger"
                onClick={() => {
                  close();
                  setConfirmingDeleteReportId(report.id);
                }}
              >
                Excluir
              </button>
            )}
          </>
        )}
      </KebabMenu>
    );
  }

  // Estilo unico compartilhado por relatorio/painel/apresentacao: card expansivel com botao
  // de tela cheia, igual ao painel (a excecao e o Modo TV, que tem fluxo proprio de playlist).
  function reportSection(type: DisplayType, sectionReports: Report[], extraHeaderAction?: ReactNode) {
    if (sectionReports.length === 0) return null;
    return (
      <div key={type}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{SECTION_TITLES[type]}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {extraHeaderAction}
            {viewModeToggle()}
          </div>
        </div>
        {viewMode === "icon" ? (
          <div key="icon" className="view-mode-fade">
            {iconGrid(sectionReports)}
          </div>
        ) : (
          <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {sectionReports.map((report) => (
              <div key={report.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button className="settings-group-toggle" onClick={() => toggleActiveReport(report.id)}>
                    <span>{activeReportId === report.id ? "▾" : "▸"}</span> {report.name}
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {activeReportId === report.id && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setFullscreenReportId(report.id)}
                        title="Tela cheia"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          fullscreen
                        </span>
                      </button>
                    )}
                    {reorderControls(report, sectionReports)}
                    {reportActionsMenu(report)}
                  </div>
                </div>
                {mountedReportIds.has(report.id) && (
                  <div
                    style={{
                      display: activeReportId === report.id ? "block" : "none",
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: "1px solid var(--color-border)",
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <ReportRefreshInfo workspaceId={currentWorkspace!.id} reportId={report.id} />
                    </div>
                    <ReportEmbed reportId={report.id} height={360} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ color: "var(--color-primary)", margin: 0 }}>{currentWorkspace.name}</h1>
          {currentWorkspace.description && (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 6 }}>{currentWorkspace.description}</p>
          )}
        </div>
        {(canWrite || isAdmin) && (
          <KebabMenu>
            {(close) => (
              <>
                {canWrite && (
                  <button
                    className="kebab-menu-item"
                    onClick={() => {
                      close();
                      setCreatingReport(true);
                    }}
                  >
                    + Adicionar
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="kebab-menu-item"
                    onClick={() => {
                      close();
                      setEditingCollection(true);
                    }}
                  >
                    Editar colecao
                  </button>
                )}
              </>
            )}
          </KebabMenu>
        )}
      </div>

      {loading ? (
        <SkeletonList count={2} />
      ) : reports.length === 0 ? (
        <>
          <h3 style={{ marginTop: 32, marginBottom: 12 }}>Relatorios</h3>
          <p style={{ color: "var(--color-text-muted)" }}>Nenhum relatorio nesta colecao ainda.</p>
        </>
      ) : (
        <>
          <div style={{ marginTop: 20 }}>
            <ListFilter value={filter} onChange={setFilter} total={reports.length} resultCount={shownTotal} />
          </div>
          {filtering && shownTotal === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>Nenhum relatorio encontrado para "{filter.trim()}".</p>
          )}
          {reportSection("relatorio", shownRelatorio)}
          {reportSection("painel", shownPainel)}
          {reportSection(
            "apresentacao",
            shownApresentacao,
            <button className="btn btn-secondary btn-sm" onClick={() => setFullscreenSection("apresentacao")}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>
                play_arrow
              </span>
              Abrir apresentacao
            </button>
          )}

          {shownTv.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{SECTION_TITLES.tv}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {isAdmin && (
                    <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                      Tempo (s)
                      <input
                        className="input"
                        type="number"
                        min={3}
                        max={3600}
                        value={tvIntervalDraft}
                        onChange={(e) => setTvIntervalDraft(e.target.value)}
                        onBlur={(e) => handleTvIntervalCommit(e.target.value)}
                        style={{ width: 70 }}
                      />
                    </label>
                  )}
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`/tv/${currentWorkspace.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir em nova aba
                  </a>
                  <button className="btn btn-secondary btn-sm" onClick={() => setFullscreenSection("tv")}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>
                      play_arrow
                    </span>
                    Abrir modo TV
                  </button>
                </div>
              </div>
              {iconGrid(shownTv)}
            </>
          )}
        </>
      )}

      {canWrite && creatingReport && (
        <NewReportForm
          onCreated={() => {
            refreshReports();
            showToast("Relatorio adicionado.");
          }}
          onClose={() => setCreatingReport(false)}
        />
      )}

      {canWrite && editingReport && (
        <NewReportForm
          key={editingReport.id}
          editingReport={editingReport}
          onCreated={() => {
            refreshReports();
            showToast("Relatorio atualizado.");
          }}
          onClose={() => setEditingReport(null)}
        />
      )}

      {editingCollection && currentWorkspace && (
        <EditCollectionModal
          workspace={currentWorkspace}
          onSaved={reloadWorkspaces}
          onClose={() => setEditingCollection(false)}
        />
      )}

      {confirmingDeleteReportId !== null && (
        <ConfirmDialog
          title="Excluir relatorio"
          message="Tem certeza que deseja excluir este relatorio?"
          confirmLabel="Excluir"
          onConfirm={() => {
            const reportId = confirmingDeleteReportId;
            setConfirmingDeleteReportId(null);
            handleDeleteReport(reportId);
          }}
          onCancel={() => setConfirmingDeleteReportId(null)}
        />
      )}
    </div>
  );
}
