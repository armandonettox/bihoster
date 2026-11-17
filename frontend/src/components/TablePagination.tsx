import { pageButtons, pageRange, PAGE_SIZE_OPTIONS, totalPages } from "../utils/pagination";

/** Rodapé de uma tabela paginada: quais linhas estão na tela, quantas por página e a troca de página. Não guarda
 * estado: quem usa passa a página e a quantidade (ver `usePagination`). */
export default function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  const pages = totalPages(total, pageSize);
  const { first, last } = pageRange(page, total, pageSize);
  // Se a quantidade em uso não estiver na lista (vinda de fora), ela aparece mesmo assim
  const options = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div className="table-pager">
      <span className="table-pager-range" role="status">
        {first}-{last} de {total}
      </span>

      <div className="table-pager-controls">
        <label className="table-pager-size">
          Linhas por página
          <select className="input" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <nav className="table-pager-pages" aria-label="Paginação">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Anterior
          </button>
          {pageButtons(page, pages).map((button, index) =>
            button === "gap" ? (
              <span key={`gap-${index}`} className="table-pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={button}
                type="button"
                className={`btn btn-sm table-pager-page ${button === page ? "table-pager-page-active" : "btn-ghost"}`}
                aria-label={`Página ${button}`}
                aria-current={button === page ? "page" : undefined}
                onClick={() => onPageChange(button)}
              >
                {button}
              </button>
            ),
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
          </button>
        </nav>
      </div>
    </div>
  );
}
