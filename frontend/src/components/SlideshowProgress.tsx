import type { CSSProperties } from "react";

interface SlideshowProgressProps {
  /** Vem de useSlideshow: a barra reinicia quando `key` muda, dura `durationMs` e parte de `from` (0 a 1) */
  countdown: { key: number; durationMs: number; from: number };
  paused: boolean;
}

/**
 * Barra fina que enche ate a proxima troca de relatorio. E so CSS (animacao): o temporizador de
 * verdade e o do hook, a barra apenas o acompanha. Pausar congela a animacao no ponto atual e
 * retomar reinicia com o tempo que faltava, entao os dois ficam sincronizados.
 */
export default function SlideshowProgress({ countdown, paused }: SlideshowProgressProps) {
  const style = {
    "--duration": `${countdown.durationMs}ms`,
    "--from": countdown.from,
    animationPlayState: paused ? "paused" : "running",
  } as CSSProperties;

  return (
    <div className="slideshow-progress" aria-hidden="true">
      {/* key: trocar de slide (ou retomar) remonta o elemento e reinicia a animacao */}
      <div key={countdown.key} className="slideshow-progress-bar" style={style} />
    </div>
  );
}
