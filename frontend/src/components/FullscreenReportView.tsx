import type { Report } from "../api/reports";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useSlideshow } from "../hooks/useSlideshow";
import { useSlideshowKeys } from "../hooks/useSlideshowKeys";
import FullscreenHeader from "./FullscreenHeader";
import ReportEmbed from "./ReportEmbed";
import SlideshowControls from "./SlideshowControls";
import SlideshowProgress from "./SlideshowProgress";

export default function FullscreenReportView({
  mode,
  reports,
  tvIntervalSeconds = 15,
  onExit,
}: {
  mode: "tv" | "apresentacao";
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

  useEscapeKey(onExit);

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
      {/* Aqui o conteudo troca sozinho: o nome do relatorio fica escrito ao lado da logo */}
      <FullscreenHeader
        title={current.name}
        showTitle
        onExit={onExit}
        controls={
          <SlideshowControls
            index={index}
            count={reports.length}
            paused={slideshow.paused}
            onPrev={slideshow.prev}
            onNext={slideshow.next}
            onTogglePause={isTv ? slideshow.togglePause : undefined}
          />
        }
      />
      {isTv && reports.length > 1 && <SlideshowProgress countdown={slideshow.countdown} paused={slideshow.paused} />}
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} height="100%" />
      </div>
    </div>
  );
}
