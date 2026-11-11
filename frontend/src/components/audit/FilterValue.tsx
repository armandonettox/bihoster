interface Props {
  children: string;
  /** Dica ao passar o cursor, ex: "Filtrar por esta acao" */
  hint: string;
  onClick: () => void;
}

/** Valor de uma celula da tabela que filtra ao clicar. Parece texto comum e ganha o sublinhado
 * pontilhado ao passar o cursor, igual ao nome da pessoa. */
export default function FilterValue({ children, hint, onClick }: Props) {
  return (
    <button type="button" className="cell-filter" title={hint} onClick={onClick}>
      {children}
    </button>
  );
}
