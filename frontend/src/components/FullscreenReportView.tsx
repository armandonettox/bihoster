import { useEffect } from "react";
import type { Report } from "../api/reports";
import { useSlideshow } from "../hooks/useSlideshow";
import { useSlideshowKeys } from "../hooks/useSlideshowKeys";
import ReportEmbed from "./ReportEmbed";
import SlideshowControls from "./SlideshowControls";
import SlideshowProgress from "./SlideshowProgress";

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
  const isTv = mode === "tv";
  // TV troca sozinha (com pausa); Apresentacao so navega pelas setas e pelos botoes
  const slideshow = useSlideshow({ count: reports.length, intervalMs: tvIntervalSeconds * 1000, autoAdvance: isTv });
  const { index } = slideshow;

  useSlideshowKeys({
    onNext: slideshow.next,
    onPrev: slideshow.prev,
    onTogglePause: isTv ? slideshow.togglePause : undefined,
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onExit();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <SlideshowControls
            index={index}
            count={reports.length}
            paused={slideshow.paused}
            onPrev={slideshow.prev}
            onNext={slideshow.next}
            onTogglePause={isTv ? slideshow.togglePause : undefined}
          />
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Sair (Esc)
          </button>
        </div>
      </div>
      {isTv && reports.length > 1 && <SlideshowProgress countdown={slideshow.countdown} paused={slideshow.paused} />}
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} height="100%" />
      </div>
    </div>
  );
}
