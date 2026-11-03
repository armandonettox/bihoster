import type { Report } from "../api/reports";
import type { Workspace } from "../api/workspaces";
import CollectionIcon from "./CollectionIcon";
import type { ViewMode } from "./ViewModeToggle";

export default function FavoriteReportList({
  reports,
  emptyMessage,
  workspaces,
  viewMode,
  onOpen,
}: {
  reports: Report[];
  emptyMessage: string;
  workspaces: Workspace[];
  viewMode: ViewMode;
  onOpen: (report: Report) => void;
}) {
  if (reports.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{emptyMessage}</p>;
  }

  if (viewMode === "icon") {
    return (
      <div key="icon" className="settings-grid view-mode-fade">
        {reports.map((report) => {
          const workspace = workspaces.find((w) => w.id === report.collection_id);
          return (
            <button key={report.id} className="card home-collection-item" onClick={() => onOpen(report)}>
              <CollectionIcon name={report.name} icon={workspace?.icon} color={workspace?.color} size={32} />
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 700 }}>{report.name}</div>
                {workspace && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{workspace.name}</div>}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {reports.map((report) => {
        const workspace = workspaces.find((w) => w.id === report.collection_id);
        return (
          <button key={report.id} className="card home-page-item" onClick={() => onOpen(report)}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span className="home-page-item-dot" />
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {report.name}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span className="badge badge-name">{workspace?.name || ""}</span>
              <span className="home-page-item-arrow">&rsaquo;</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
