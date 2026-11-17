/** Quantas linhas uma tabela mostra por página quando a pessoa não escolheu outra quantidade */
export const DEFAULT_PAGE_SIZE = 20;

/** Quantidades de linhas por página que a pessoa pode escolher */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** Quantas páginas há (sempre pelo menos uma, mesmo sem linhas) */
export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Mantém a página dentro do que existe: depois de apagar a última linha da última página, por exemplo, volta uma */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), totalPages(total, pageSize));
}

/** Primeira e última linha mostradas na página (1 a 20 de 57); 0 e 0 quando não há linhas */
export function pageRange(page: number, total: number, pageSize: number): { first: number; last: number } {
  if (total === 0) return { first: 0, last: 0 };
  return { first: (page - 1) * pageSize + 1, last: Math.min(page * pageSize, total) };
}

export type PageButton = number | "gap";

/** Os botões de página a mostrar: todas se forem poucas; senão a primeira, a última e as vizinhas da atual, com
 * reticências no meio (por exemplo 1 … 4 5 6 … 20). */
export function pageButtons(page: number, pages: number): PageButton[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const wanted = new Set<number>([1, pages, page - 1, page, page + 1]);
  // Perto das pontas mostra um pouco mais, para a fila não pular de tamanho ao navegar
  if (page <= 3) [2, 3, 4].forEach((p) => wanted.add(p));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((p) => wanted.add(p));

  const sorted = [...wanted].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const buttons: PageButton[] = [];
  sorted.forEach((p, index) => {
    if (index > 0) {
      const hidden = p - sorted[index - 1] - 1;
      // Reticências escondendo uma página só seriam pior que mostrar a própria página
      if (hidden === 1) buttons.push(sorted[index - 1] + 1);
      else if (hidden > 1) buttons.push("gap");
    }
    buttons.push(p);
  });
  return buttons;
}
