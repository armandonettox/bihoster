import type { HomeCollectionEntry } from "../api/home";
import CollectionIcon from "./CollectionIcon";
import type { ViewMode } from "./ViewModeToggle";

export default function CollectionEntryList({
  entries,
  emptyMessage,
  viewMode,
  onOpen,
}: {
  entries: HomeCollectionEntry[];
  emptyMessage: string;
  viewMode: ViewMode;
  onOpen: (entry: HomeCollectionEntry) => void;
}) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{emptyMessage}</p>;
  }

  if (viewMode === "icon") {
    return (
      <div key="icon" className="settings-grid view-mode-fade">
        {entries.map((entry) => (
          <button key={entry.id} className="card home-collection-item" onClick={() => onOpen(entry)}>
            <CollectionIcon name={entry.name} icon={entry.icon} color={entry.color} size={32} />
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{entry.name}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((entry) => (
        <button key={entry.id} className="card home-page-item" onClick={() => onOpen(entry)}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span className="home-page-item-dot" />
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.name}
            </span>
          </span>
          <span className="home-page-item-arrow">&rsaquo;</span>
        </button>
      ))}
    </div>
  );
}
