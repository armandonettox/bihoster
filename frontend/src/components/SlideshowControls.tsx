interface SlideshowControlsProps {
  index: number;
  count: number;
  paused?: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Sem ele (Apresentacao, que nao avanca sozinha) nao ha botao de pausa */
  onTogglePause?: () => void;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
      {name}
    </span>
  );
}

/** Anterior, pausar/retomar, proximo e a posicao (1 / N) de uma exibicao de relatorios. */
export default function SlideshowControls({ index, count, paused = false, onPrev, onNext, onTogglePause }: SlideshowControlsProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {count > 1 && (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onPrev} aria-label="Relatorio anterior" title="Anterior (seta esquerda)">
            <Icon name="skip_previous" />
          </button>
          {onTogglePause && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onTogglePause}
              aria-label={paused ? "Retomar exibicao" : "Pausar exibicao"}
              title={paused ? "Retomar (Espaco)" : "Pausar (Espaco)"}
            >
              <Icon name={paused ? "play_arrow" : "pause"} />
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onNext} aria-label="Proximo relatorio" title="Proximo (seta direita)">
            <Icon name="skip_next" />
          </button>
        </>
      )}
      <span style={{ fontSize: 13, color: "var(--color-text-muted)", minWidth: 44, textAlign: "center" }}>
        {index + 1} / {count}
      </span>
    </div>
  );
}
