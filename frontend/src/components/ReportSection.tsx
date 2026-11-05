import { type ReactNode, useRef, useState } from "react";
import type { Report } from "../api/reports";
import ReportEmbed, { type ReportEmbedHandle, type TableVisualInfo } from "./ReportEmbed";
import ReportIconGrid from "./ReportIconGrid";
import ViewModeToggle, { type ViewMode } from "./ViewModeToggle";

// Estilo unico compartilhado por relatorio/painel/apresentacao: card expansivel com botao
// de tela cheia, igual ao painel (a excecao e o Modo TV, que tem fluxo proprio de playlist).
export default function ReportSection({
  title,
  reports,
  viewMode,
  onViewModeChange,
  headerAction,
  activeReportId,
  onToggleActive,
  onOpenFullscreen,
  renderActions,
}: {
  title: string;
  reports: Report[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  headerAction?: ReactNode;
  activeReportId: number | null;
  onToggleActive: (reportId: number) => void;
  onOpenFullscreen: (reportId: number) => void;
  renderActions: (report: Report, sectionReports: Report[]) => ReactNode;
}) {
  const embedRef = useRef<ReportEmbedHandle>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [visualList, setVisualList] = useState<TableVisualInfo[] | null>(null);

  async function handleExportClick() {
    setExportError(null);
    setVisualList(null);
    setExporting(true);
    try {
      const visuals = await embedRef.current?.getTableVisuals();
      if (!visuals || visuals.length === 0) {
        throw new Error("Nenhum visual de tabela encontrado na pagina atual.");
      }
      if (visuals.length === 1) {
        await embedRef.current?.exportTableData(visuals[0].name);
      } else {
        setVisualList(visuals);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar os dados.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportVisual(visualName: string) {
    setVisualList(null);
    setExportError(null);
    try {
      await embedRef.current?.exportTableData(visualName);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar os dados.");
    }
  }

  if (reports.length === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerAction}
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        </div>
      </div>
      {viewMode === "icon" ? (
        <div key="icon" className="view-mode-fade">
          <ReportIconGrid
            reports={reports}
            onOpenFullscreen={onOpenFullscreen}
            renderActions={renderActions}
          />
        </div>
      ) : (
        <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {reports.map((report) => (
            <div key={report.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button className="settings-group-toggle" onClick={() => onToggleActive(report.id)}>
                  <span>{activeReportId === report.id ? "▾" : "▸"}</span> {report.name}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {activeReportId === report.id && (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleExportClick}
                        disabled={exporting}
                        title="Exportar dados de tabela como CSV"
                        aria-label="Exportar dados de tabela como CSV"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">
                          download
                        </span>
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => onOpenFullscreen(report.id)} title="Tela cheia">
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          fullscreen
                        </span>
                      </button>
                    </>
                  )}
                  {renderActions(report, reports)}
                </div>
              </div>
              {exportError && activeReportId === report.id && (
                <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "6px 0 0" }}>
                  {exportError}
                </p>
              )}
              {visualList && activeReportId === report.id && (
                <div style={{ margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Qual tabela exportar?</span>
                  {visualList.map((v) => (
                    <button
                      key={v.name}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 13 }}
                      onClick={() => handleExportVisual(v.name)}
                    >
                      {v.title}
                    </button>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 13 }}
                    onClick={() => setVisualList(null)}
                    aria-label="Cancelar exportacao"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {/* So o relatorio aberto fica montado. Antes, os ja abertos ficavam vivos e escondidos, e
                  cada um continuava rodando no navegador mesmo depois de fechado. */}
              {activeReportId === report.id && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
                  <ReportEmbed ref={embedRef} reportId={report.id} height={360} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
