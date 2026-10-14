import { useEffect, useId, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Texto do botao quando nada esta marcado */
  placeholder: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Lista suspensa com caixinhas: marca varias opcoes e fecha ao clicar fora ou com Esc. */
export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
  disabled = false,
  ariaLabel,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggle(value: string) {
    // Mantem a ordem das opcoes (a do relatorio), nao a ordem em que a pessoa foi marcando
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(options.filter((opt) => next.has(opt.value)).map((opt) => opt.value));
  }

  const selectedLabels = options.filter((opt) => selected.includes(opt.value)).map((opt) => opt.label);
  let summary = placeholder;
  if (selectedLabels.length === 1) summary = selectedLabels[0];
  else if (selectedLabels.length > 1) summary = `${selectedLabels.length} abas selecionadas`;

  return (
    <div
      ref={rootRef}
      style={{ position: "relative" }}
      onKeyDown={(e) => {
        // Esc fecha so a lista, sem fechar o modal que a contem
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="input multi-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="multi-select-summary" title={selectedLabels.join(", ") || undefined}>
          {summary}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div id={listId} className="multi-select-panel" role="listbox" aria-multiselectable="true">
          {options.length === 0 ? (
            <p className="multi-select-empty">Nenhuma opcao disponivel.</p>
          ) : (
            options.map((opt) => (
              <label key={opt.value} className="multi-select-option" role="option" aria-selected={selected.includes(opt.value)}>
                <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
                <span>{opt.label}</span>
              </label>
            ))
          )}
          {selected.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm multi-select-clear" onClick={() => onChange([])}>
              Limpar selecao
            </button>
          )}
        </div>
      )}
    </div>
  );
}
