import { useEffect, useState } from "react";
import type { Report } from "../api/reports";
import ReportEmbed from "./ReportEmbed";

export default function FullscreenReportView({
  mode,
  collectionName,
  reports,
  tvIntervalSeconds = 15,
  onExit,
}: {
  mode: "tv" | "apresentacao";
  collectionName: string;
  reports: Report[];
  /** So usado no modo "tv" -- tempo de revezamento configurado na colecao. */
  tvIntervalSeconds?: number;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);

  function goNext() {
    setIndex((i) => (i + 1) % reports.length);
  }

  function goPrev() {
    setIndex((i) => (i - 1 + reports.length) % reports.length);
  }

  useEffect(() => {
    if (mode !== "tv" || reports.length < 2) return;
    const timer = setInterval(goNext, tvIntervalSeconds * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reports.length, tvIntervalSeconds]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onExit();
      } else if (mode === "apresentacao" && event.key === "ArrowRight") {
        goNext();
      } else if (mode === "apresentacao" && event.key === "ArrowLeft") {
        goPrev();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reports.length]);

  if (reports.length === 0) {
    return (
      <div className="fullscreen-view">
        <p style={{ color: "var(--color-text-muted)" }}>Nenhum relatorio nesta secao ainda.</p>
        <button className="btn btn-ghost" onClick={onExit}>
          Sair
        </button>
      </div>
    );
  }

  const current = reports[index];

  return (
    <div className="fullscreen-view">
      <div className="fullscreen-view-header">
        <div>
          <span style={{ fontWeight: 700 }}>{collectionName}</span>
          <span style={{ color: "var(--color-text-muted)", marginLeft: 10 }}>{current.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {mode === "apresentacao" && reports.length > 1 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={goPrev} aria-label="Relatorio anterior">
                ← Anterior
              </button>
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {index + 1} / {reports.length}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={goNext} aria-label="Proximo relatorio">
                Proximo →
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Sair (Esc)
          </button>
        </div>
      </div>
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} height="100%" />
      </div>
    </div>
  );
}
