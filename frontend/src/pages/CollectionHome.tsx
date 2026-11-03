import { useEffect, useState, type ReactNode } from "react";
import * as homeApi from "../api/home";
import { useFavorites } from "../context/FavoritesContext";
import type { DisplayType, Report } from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import NewReportForm from "../components/NewReportForm";
import FullscreenReportView from "../components/FullscreenReportView";
import FullscreenSingleReport from "../components/FullscreenSingleReport";
import EditCollectionModal from "../components/EditCollectionModal";
import KebabMenu from "../components/KebabMenu";
import ReorderButtons from "../components/ReorderButtons";
import ReportActionsMenu from "../components/ReportActionsMenu";
import ReportIconGrid from "../components/ReportIconGrid";
import ReportSection from "../components/ReportSection";
import TvSectionHeader from "../components/TvSectionHeader";
import type { ViewMode } from "../components/ViewModeToggle";
import ListFilter from "../components/ListFilter";
import { filterByName } from "../utils/filterByName";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "../components/ConfirmDialog";
import { safeStorage } from "../utils/safeStorage";
import { useCollectionReports } from "../hooks/useCollectionReports";
import { useTvInterval } from "../hooks/useTvInterval";

const SECTION_TITLES: Record<DisplayType, string> = {
  relatorio: "Relatorios",
  painel: "Painel",
  apresentacao: "Apresentacao",
  tv: "Modo TV",
};

const VIEW_MODE_KEY = "collection_view_mode";

export default function CollectionHome() {
  const { currentWorkspace, reload: reloadWorkspaces } = useWorkspace();
  const { showToast } = useToast();
  const { favoriteIds, toggleFavorite } = useFavorites();

  // Os efeitos abaixo dependem so do id da colecao, nao do objeto: o reload do WorkspaceContext
  // cria um objeto novo a cada chamada (ex: ao mudar o intervalo da TV ou editar a colecao), e
  // depender do objeto resetava a pagina inteira e registrava a visita em "Recentes" de novo.
  const workspaceId = currentWorkspace?.id;

  const {
    reports,
    loading,
    refreshReports,
    activeReportId,
    mountedReportIds,
    toggleActiveReport,
    deleteReport,
    movingReportId,
    moveReport,
  } = useCollectionReports(workspaceId);
  const tvInterval = useTvInterval(currentWorkspace, reloadWorkspaces);

  const [creatingReport, setCreatingReport] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [editingCollection, setEditingCollection] = useState(false);
  const [confirmingDeleteReportId, setConfirmingDeleteReportId] = useState<number | null>(null);
  const [fullscreenSection, setFullscreenSection] = useState<"apresentacao" | "tv" | null>(null);
  const [fullscreenReportId, setFullscreenReportId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (safeStorage.getItem(VIEW_MODE_KEY) as ViewMode) || "icon"
  );
  const [filter, setFilter] = useState("");

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    safeStorage.setItem(VIEW_MODE_KEY, mode);
  }

  const role = currentWorkspace?.role;
  const canWrite = role === "admin" || role === "editor";
  const isAdmin = role === "admin";

  // O filtro e a tela cheia sao da colecao aberta: ao trocar de colecao, comecam limpos
  useEffect(() => {
    setFilter("");
    setFullscreenSection(null);
    setFullscreenReportId(null);
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId === undefined) return;
    homeApi.recordCollectionView(workspaceId).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!fullscreenReportId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreenReportId(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenReportId]);

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
      <FullscreenSingleReport
        collectionName={currentWorkspace.name}
        report={fullscreenReport}
        onExit={() => setFullscreenReportId(null)}
      />
    );
  }

  // A ordem so importa (e so pode ser mudada) no Modo TV e na Apresentacao, onde ela define a
  // sequencia de exibicao, e so por quem pode editar.
  function reorderControls(report: Report, sectionReports: Report[]) {
    // Com filtro a secao mostrada e so uma parte: "subir" pareceria pular itens escondidos, porque
    // o servidor troca com o vizinho da secao completa. Limpe o filtro pra reordenar.
    if (!canWrite || filtering || sectionReports.length < 2) return null;
    if (report.display_type !== "tv" && report.display_type !== "apresentacao") return null;
    const index = sectionReports.findIndex((r) => r.id === report.id);
    return (
      <ReorderButtons
        name={report.name}
        canMoveUp={index > 0}
        canMoveDown={index >= 0 && index < sectionReports.length - 1}
        busy={movingReportId !== null}
        onMove={(direction) => moveReport(report, direction)}
      />
    );
  }

  function renderActions(report: Report, sectionReports: Report[]) {
    return (
      <>
        {reorderControls(report, sectionReports)}
        <ReportActionsMenu
          report={report}
          canWrite={canWrite}
          isFavorite={favoriteIds.has(report.id)}
          onToggleFavorite={(r) => toggleFavorite(r.id, r)}
          onEdit={setEditingReport}
          onDelete={setConfirmingDeleteReportId}
        />
      </>
    );
  }

  function section(type: DisplayType, sectionReports: Report[], headerAction?: ReactNode) {
    return (
      <ReportSection
        title={SECTION_TITLES[type]}
        reports={sectionReports}
        workspaceId={currentWorkspace!.id}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        headerAction={headerAction}
        activeReportId={activeReportId}
        mountedReportIds={mountedReportIds}
        onToggleActive={toggleActiveReport}
        onOpenFullscreen={setFullscreenReportId}
        renderActions={renderActions}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ color: "var(--color-primary-text)", margin: 0 }}>{currentWorkspace.name}</h1>
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
          {section("relatorio", shownRelatorio)}
          {section("painel", shownPainel)}
          {section(
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
              <TvSectionHeader
                title={SECTION_TITLES.tv}
                workspaceId={currentWorkspace.id}
                isAdmin={isAdmin}
                intervalDraft={tvInterval.draft}
                onIntervalChange={tvInterval.setDraft}
                onIntervalCommit={tvInterval.commit}
                onOpenTv={() => setFullscreenSection("tv")}
              />
              <ReportIconGrid
                reports={shownTv}
                workspaceId={currentWorkspace.id}
                onOpenFullscreen={setFullscreenReportId}
                renderActions={renderActions}
              />
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
            deleteReport(reportId);
          }}
          onCancel={() => setConfirmingDeleteReportId(null)}
        />
      )}
    </div>
  );
}
