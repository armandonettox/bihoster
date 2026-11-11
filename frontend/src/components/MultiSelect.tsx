import { useState } from "react";
import { useDropdownMenu } from "../hooks/useDropdownMenu";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Texto menor ao lado do nome, ex: o email da pessoa. Tambem entra na busca. */
  hint?: string;
}

interface Props {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Texto do botao quando nada esta marcado (nao filtra) */
  emptyLabel?: string;
}

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function summary(options: MultiSelectOption[], selected: string[], emptyLabel: string): string {
  if (selected.length === 0) return emptyLabel;
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? "1 selecionado";
  return `${selected.length} selecionados`;
}

/** Lista suspensa com busca e selecao multipla. Nada marcado = sem filtro. */
export default function MultiSelect({ label, options, selected, onChange, emptyLabel = "Todas" }: Props) {
  const { open, setOpen, containerRef, triggerRef } = useDropdownMenu();
  const [search, setSearch] = useState("");

  const needle = plain(search.trim());
  const visible = needle ? options.filter((o) => plain(`${o.label} ${o.hint ?? ""}`).includes(needle)) : options;
  const visibleValues = visible.map((o) => o.value);
  const allVisibleSelected = visible.length > 0 && visibleValues.every((v) => selected.includes(v));

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function toggleAllVisible() {
    onChange(
      allVisibleSelected
        ? selected.filter((v) => !visibleValues.includes(v))
        : [...selected, ...visibleValues.filter((v) => !selected.includes(v))],
    );
  }

  function handleToggleOpen() {
    setSearch(""); // abre e fecha sempre com a busca limpa
    setOpen((prev) => !prev);
  }

  return (
    <div className="multiselect" ref={containerRef}>
      <span className="multiselect-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={`input multiselect-trigger ${selected.length > 0 ? "multiselect-trigger-active" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label}: ${summary(options, selected, emptyLabel)}`}
        onClick={handleToggleOpen}
      >
        <span className="multiselect-value">{summary(options, selected, emptyLabel)}</span>
        {selected.length > 1 && <span className="multiselect-count">{selected.length}</span>}
        <span className="material-symbols-outlined multiselect-arrow" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div className="multiselect-panel" role="group" aria-label={label}>
          <div className="multiselect-search">
            <span className="material-symbols-outlined" aria-hidden="true">search</span>
            <input
              className="input"
              type="search"
              autoFocus
              placeholder="Pesquisar..."
              aria-label={`Pesquisar em ${label}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="multiselect-actions">
            <button type="button" className="multiselect-link" onClick={toggleAllVisible} disabled={visible.length === 0}>
              {allVisibleSelected ? "Desmarcar" : needle ? "Marcar resultados" : "Marcar todos"}
            </button>
            <button type="button" className="multiselect-link" onClick={() => onChange([])} disabled={selected.length === 0}>
              Limpar
            </button>
          </div>

          <ul className="multiselect-list">
            {visible.length === 0 ? (
              <li className="multiselect-empty">Nenhum resultado</li>
            ) : (
              visible.map((option) => (
                <li key={option.value}>
                  <label
                    className={`multiselect-option ${selected.includes(option.value) ? "multiselect-option-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(option.value)}
                      onChange={() => toggle(option.value)}
                    />
                    <span className="multiselect-option-text">
                      {option.label}
                      {option.hint && <small>{option.hint}</small>}
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
