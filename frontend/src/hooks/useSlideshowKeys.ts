import { useEffect, useRef } from "react";

interface SlideshowKeysOptions {
  onNext: () => void;
  onPrev: () => void;
  /** Sem ele (Apresentacao, que nao tem pausa), a tecla Espaco nao e interceptada */
  onTogglePause?: () => void;
}

/** Foco em campo de texto: as teclas pertencem ao campo, nao a exibicao. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Atalhos de teclado da exibicao de slides: seta direita avanca, seta esquerda volta e Espaco
 * pausa/retoma (quando `onTogglePause` existe). Ignora campos de texto e teclas com Ctrl/Alt/Meta.
 * Os callbacks ficam num ref: o listener e registrado uma vez e sempre chama a versao mais nova.
 */
export function useSlideshowKeys(options: SlideshowKeysOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;

      const { onNext, onPrev, onTogglePause } = optionsRef.current;
      if (event.key === "ArrowRight") {
        onNext();
      } else if (event.key === "ArrowLeft") {
        onPrev();
      } else if (event.key === " " && onTogglePause) {
        // preventDefault: sem isso o Espaco tambem rola a pagina
        event.preventDefault();
        onTogglePause();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
