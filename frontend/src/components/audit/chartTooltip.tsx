import { useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Conteudo do rotulo que aparece ao passar o cursor num ponto, barra ou fatia */
export interface TipContent {
  title: string;
  value: string;
  /** Linha pequena abaixo: o email da pessoa, "Clique para filtrar"... */
  hint?: string;
}

interface Tip {
  content: TipContent;
  x: number;
  y: number;
}

const OFFSET = 14;
const TIP_WIDTH = 240;

/** Rotulo que segue o cursor. Sai do fluxo da pagina (portal): o painel usa transformacoes CSS
 * para posicionar os visuais, e um elemento fixo dentro delas ficaria deslocado e cortado. */
export function useChartTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);

  const bind = (content: TipContent) => ({
    onMouseEnter: (event: MouseEvent) => setTip({ content, x: event.clientX, y: event.clientY }),
    onMouseMove: (event: MouseEvent) => setTip({ content, x: event.clientX, y: event.clientY }),
    onMouseLeave: () => setTip(null),
  });

  let element: ReactNode = null;
  if (tip) {
    // Perto da borda direita o rotulo abre para a esquerda do cursor, para nao sair da janela
    const nearRight = tip.x + OFFSET + TIP_WIDTH > window.innerWidth;
    const style = nearRight
      ? { right: window.innerWidth - tip.x + OFFSET, top: tip.y + OFFSET }
      : { left: tip.x + OFFSET, top: tip.y + OFFSET };
    element = createPortal(
      <div className="chart-tooltip" role="tooltip" style={style}>
        <div className="chart-tooltip-title">{tip.content.title}</div>
        <div className="chart-tooltip-value">{tip.content.value}</div>
        {tip.content.hint && <div className="chart-tooltip-hint">{tip.content.hint}</div>}
      </div>,
      document.body,
    );
  }

  return { bind, element };
}
