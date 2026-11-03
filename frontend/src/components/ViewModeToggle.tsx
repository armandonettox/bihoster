export type ViewMode = "list" | "icon";

export default function ViewModeToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      <button
        className={`btn btn-ghost btn-sm ${viewMode === "list" ? "btn-ghost-active" : ""}`}
        onClick={() => onChange("list")}
        title="Ver como lista"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          view_list
        </span>
      </button>
      <button
        className={`btn btn-ghost btn-sm ${viewMode === "icon" ? "btn-ghost-active" : ""}`}
        onClick={() => onChange("icon")}
        title="Ver como icones"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          grid_view
        </span>
      </button>
    </div>
  );
}
