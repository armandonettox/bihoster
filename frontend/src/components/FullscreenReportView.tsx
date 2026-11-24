import type { Report } from "../api/reports";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useSlideshow } from "../hooks/useSlideshow";
import { useSlideshowKeys } from "../hooks/useSlideshowKeys";
import FullscreenHeader from "./FullscreenHeader";
import ReportEmbed from "./ReportEmbed";
import SlideshowControls from "./SlideshowControls";

export default function FullscreenReportView({
  reports,
  onExit,
}: {
  reports: Report[];
  onExit: () => void;
}) {
  // A Apresentacao so navega pelas setas e pelos botoes, nunca sozinha
  const slideshow = useSlideshow({ count: reports.length, intervalMs: 15000, autoAdvance: false });
  const { index } = slideshow;

  useSlideshowKeys({
    onNext: slideshow.next,
    onPrev: slideshow.prev,
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
          />
        }
      />
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} height="100%" />
      </div>
    </div>
  );
}
