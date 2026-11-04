import type { ReactNode } from "react";
import type { RefreshInfo, Report } from "../api/reports";
import ReportEmbed from "./ReportEmbed";
import ReportIconGrid from "./ReportIconGrid";
import ReportRefreshInfo from "./ReportRefreshInfo";
import ViewModeToggle, { type ViewMode } from "./ViewModeToggle";

// Estilo unico compartilhado por relatorio/painel/apresentacao: card expansivel com botao
// de tela cheia, igual ao painel (a excecao e o Modo TV, que tem fluxo proprio de playlist).
export default function ReportSection({
  title,
  reports,
  refreshInfo,
  viewMode,
  onViewModeChange,
  headerAction,
  activeReportId,
  mountedReportIds,
  onToggleActive,
  onOpenFullscreen,
  renderActions,
}: {
  title: string;
  reports: Report[];
  /** Ultima/proxima atualizacao por id de relatorio (como texto) */
  refreshInfo: Record<string, RefreshInfo>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  headerAction?: ReactNode;
  activeReportId: number | null;
  mountedReportIds: Set<number>;
  onToggleActive: (reportId: number) => void;
  onOpenFullscreen: (reportId: number) => void;
  renderActions: (report: Report, sectionReports: Report[]) => ReactNode;
}) {
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
            refreshInfo={refreshInfo}
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
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenFullscreen(report.id)} title="Tela cheia">
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        fullscreen
                      </span>
                    </button>
                  )}
                  {renderActions(report, reports)}
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
                    <ReportRefreshInfo info={refreshInfo[String(report.id)]} />
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
