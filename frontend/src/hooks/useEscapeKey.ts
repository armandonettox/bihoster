import { useEffect, useRef } from "react";

/** Chama `onEscape` quando a tecla Esc e apertada na pagina. Guarda a versao mais recente da funcao,
 * entao quem chama pode passar uma funcao nova a cada render sem reiniciar o ouvinte.
 *
 * Limite conhecido: com o foco DENTRO do relatorio do Power BI (um iframe de outro dominio) as teclas
 * nao chegam a esta pagina. Por isso o Esc nunca e a unica saida: ha o botao Sair e o Voltar do navegador. */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const ref = useRef(onEscape);
  // Atualiza depois de cada render (nao durante ele): o ouvinte abaixo le sempre a versao mais recente
  useEffect(() => {
    ref.current = onEscape;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") ref.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
