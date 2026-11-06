import type { ReactNode } from "react";
import type { Report } from "../api/reports";
import LazyMount from "./LazyMount";
import ReportThumbnail from "./ReportThumbnail";

export default function ReportIconGrid({
  reports,
  onOpenFullscreen,
  renderActions,
}: {
  reports: Report[];
  onOpenFullscreen: (reportId: number) => void;
  renderActions: (report: Report, sectionReports: Report[]) => ReactNode;
}) {
  return (
    <div className="report-icon-grid" style={{ marginBottom: 20 }}>
      {reports.map((report) => (
        <div
          key={report.id}
          className="card report-icon-card"
          role="button"
          tabIndex={0}
          onClick={() => onOpenFullscreen(report.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenFullscreen(report.id);
            }
          }}
        >
          <div className="report-icon-card-preview">
            <LazyMount unmountWhenHidden placeholder={<div className="skeleton report-icon-card-preview-skeleton" />}>
              <ReportThumbnail reportId={report.id} thumbnailUrl={report.thumbnail_url} />
            </LazyMount>
            <div className="report-icon-card-overlay">
              <span className="material-symbols-outlined">fullscreen</span>
            </div>
          </div>
          <div className="report-icon-card-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{report.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                {renderActions(report, reports)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
