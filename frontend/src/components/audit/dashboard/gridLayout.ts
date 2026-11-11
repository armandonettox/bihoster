import type { Layout } from "react-grid-layout";
import type { DashboardWidget } from "../../../api/audit";

export const ROW_HEIGHT = 40;
export const GRID_GAP = 12;
/** Abaixo dessa largura a grade de 20 colunas fica minuscula: os visuais empilham e nao da para editar */
export const STACK_BELOW_PX = 720;

// Tamanho minimo de cada tipo, para ninguem encolher um visual ate sumir
export const MIN_SIZE: Record<string, { w: number; h: number }> = {
  stat: { w: 3, h: 2 },
  line: { w: 6, h: 4 },
  bars: { w: 5, h: 4 },
  hours: { w: 6, h: 4 },
  donut: { w: 6, h: 4 },
};

/** Posicao e tamanho que a grade devolveu, aplicados de volta nos visuais. */
export function applyLayout(widgets: DashboardWidget[], layout: Layout): DashboardWidget[] {
  const byId = new Map(layout.map((item) => [item.i, item]));
  return widgets.map((widget) => {
    const item = byId.get(widget.id);
    return item ? { ...widget, x: item.x, y: item.y, w: item.w, h: item.h } : widget;
  });
}

/** Ordem de leitura (de cima para baixo, da esquerda para a direita) para empilhar em tela estreita */
export function readingOrder(widgets: DashboardWidget[]): DashboardWidget[] {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}
