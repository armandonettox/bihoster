import type { ReactNode } from "react";

export const DEFAULT_PRIMARY = "#1E3A6B";
export const DEFAULT_SECONDARY = "#5B9BD5";
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// As prévias ficam na coluna da direita da janela de edição (cerca de 420 px): 0.55 dos 720 px da tela cabe com folga
export const PREVIEW_SCALE = 0.55;

export const PRESET_PALETTES: { name: string; primary: string; secondary: string }[] = [
  { name: "Netto Code", primary: "#1E3A6B", secondary: "#5B9BD5" },
  { name: "Grafite", primary: "#1F2937", secondary: "#6B7280" },
  { name: "Esmeralda", primary: "#065F46", secondary: "#10B981" },
  { name: "Vinho", primary: "#7F1D1D", secondary: "#F87171" },
  { name: "Roxo", primary: "#4C1D95", secondary: "#A78BFA" },
  { name: "Laranja", primary: "#9A3412", secondary: "#FB923C" },
];

export function normalizeHex(value: string): string {
  let v = value.trim();
  if (!v.startsWith("#")) v = `#${v}`;
  return v;
}

export const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Cor com seletor e campo de código. O rótulo aponta para o campo de código; o seletor tem nome próprio. */
export function ColorField({
  id,
  label,
  color,
  hexInput,
  valid,
  onPick,
  onHexChange,
}: {
  id: string;
  label: string;
  color: string;
  hexInput: string;
  valid: boolean;
  onPick: (value: string) => void;
  onHexChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`color-field ${!valid ? "color-field-invalid" : ""}`}>
        <input type="color" value={color} aria-label={`Escolher ${label.toLowerCase()}`} onChange={(e) => onPick(e.target.value)} />
        <input
          id={id}
          className="color-field-hex"
          value={hexInput}
          onChange={(e) => onHexChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
        />
      </div>
      {!valid && (
        <span className="field-error" role="alert">
          Use o formato #RRGGBB
        </span>
      )}
    </div>
  );
}

/** Uma das duas opções de layout da tela de login */
export function LayoutOption({
  checked,
  onChange,
  title,
  description,
  thumb,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
  thumb: ReactNode;
}) {
  return (
    <label className="card visibility-option brand-layout-option">
      <input type="radio" name="login_layout" checked={checked} onChange={onChange} />
      <div className="layout-thumb">{thumb}</div>
      <div>
        <div className="brand-layout-option-title">{title}</div>
        <div className="field-hint">{description}</div>
      </div>
    </label>
  );
}

/** Campo de texto de uma tela: o texto padrão aparece de sugestão (placeholder) e o contador mostra o limite */
export function ErrorTextField({
  id,
  label,
  value,
  placeholder,
  max,
  multiline = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const common = {
    id,
    className: "input",
    value,
    placeholder,
    maxLength: max,
    "aria-describedby": `${id}-hint`,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} style={{ resize: "vertical" }} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} onChange={(e) => onChange(e.target.value)} />
      )}
      <span id={`${id}-hint`} className="field-hint">
        {value.length}/{max}. Em branco, usa o texto padrão.
      </span>
    </div>
  );
}
