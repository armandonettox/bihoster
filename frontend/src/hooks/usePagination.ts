import { useState } from "react";
import { clampPage, DEFAULT_PAGE_SIZE } from "../utils/pagination";

/** Paginação feita no navegador, para tabelas que já têm todas as linhas. `resetKey` identifica o filtro ou a busca
 * em uso: quando ele muda, a tabela volta para a página 1 (derivado durante a renderização, sem efeito extra). A página
 * nunca passa do que existe, mesmo quando as linhas diminuem depois de uma exclusão. */
export function usePagination<T>(items: T[], resetKey: string, initialPageSize: number = DEFAULT_PAGE_SIZE) {
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [state, setState] = useState({ key: resetKey, page: 1 });

  const total = items.length;
  const page = clampPage(state.key === resetKey ? state.page : 1, total, pageSize);
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);

  function setPage(next: number) {
    setState({ key: resetKey, page: clampPage(next, total, pageSize) });
  }

  // Trocar a quantidade por página volta para a primeira página: a página atual não faria mais sentido
  function setPageSize(next: number) {
    setPageSizeState(next);
    setState({ key: resetKey, page: 1 });
  }

  return { page, pageSize, pageItems, total, setPage, setPageSize };
}
