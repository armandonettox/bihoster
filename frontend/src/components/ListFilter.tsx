/** Abaixo disso a lista cabe na tela e o campo de filtro so poluiria. */
export const MIN_ITEMS_FOR_FILTER = 6;

interface ListFilterProps {
  value: string;
  onChange: (value: string) => void;
  /** Quantos itens a lista tem ao todo (sem filtro) */
  total: number;
  /** Quantos sobraram depois de filtrar; mostrado ("2 de 8") so quando ha filtro */
  resultCount?: number;
  placeholder?: string;
}

/** Campo de filtro por nome. So aparece quando a lista e grande, ou enquanto houver filtro ativo. */
export default function ListFilter({ value, onChange, total, resultCount, placeholder = "Filtrar por nome..." }: ListFilterProps) {
  const active = value.trim() !== "";
  // Com filtro ativo o campo nao pode sumir: a lista pode ter encolhido e o usuario perderia o
  // jeito de limpar o filtro.
  if (total < MIN_ITEMS_FOR_FILTER && !active) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{ position: "relative", flex: "0 1 320px" }}>
        <input
          className="input"
          type="search"
          role="searchbox"
          aria-label="Filtrar por nome"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && active) onChange("");
          }}
          style={{ width: "100%", paddingRight: active ? 32 : undefined }}
        />
        {active && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Limpar filtro"
            title="Limpar filtro (Esc)"
            onClick={() => onChange("")}
            style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", padding: "2px 6px" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              close
            </span>
          </button>
        )}
      </div>
      {active && resultCount !== undefined && (
        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          {resultCount} de {total}
        </span>
      )}
    </div>
  );
}
