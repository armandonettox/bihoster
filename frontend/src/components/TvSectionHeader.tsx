export default function TvSectionHeader({
  title,
  workspaceId,
  isAdmin,
  intervalDraft,
  onIntervalChange,
  onIntervalCommit,
  onOpenTv,
}: {
  title: string;
  workspaceId: number;
  isAdmin: boolean;
  intervalDraft: string;
  onIntervalChange: (value: string) => void;
  onIntervalCommit: (value: string) => void;
  onOpenTv: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, marginBottom: 12 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {isAdmin && (
          <label style={{ fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            Tempo (s)
            <input
              className="input"
              type="number"
              min={3}
              max={3600}
              value={intervalDraft}
              onChange={(e) => onIntervalChange(e.target.value)}
              onBlur={(e) => onIntervalCommit(e.target.value)}
              style={{ width: 70 }}
            />
          </label>
        )}
        <a className="btn btn-ghost btn-sm" href={`/tv/${workspaceId}`} target="_blank" rel="noreferrer">
          Abrir em nova aba
        </a>
        <button className="btn btn-secondary btn-sm" onClick={onOpenTv}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 4 }}>
            play_arrow
          </span>
          Abrir modo TV
        </button>
      </div>
    </div>
  );
}
