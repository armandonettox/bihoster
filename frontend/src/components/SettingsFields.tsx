import type { ReactNode } from "react";

/** Campo com rótulo e dica. A dica fica fora do rótulo e é ligada ao campo por aria-describedby, para o leitor de
 * tela ler o nome do campo sem a dica junto. O campo (input ou select) leva o mesmo `id` e `aria-describedby`. */
export function Field({
  id,
  label,
  hint,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Interruptor com rótulo e dica. O rótulo é um texto à parte (não um label em volta de outro label), e o
 * interruptor leva o nome e a descrição por aria-labelledby e aria-describedby. */
export function ToggleField({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  className = "",
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <span id={`${id}-label`}>{label}</span>
      <div className="toggle-field">
        <label className="toggle-switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            aria-labelledby={`${id}-label ${id}-state`}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="toggle-switch-track" />
        </label>
        <span id={`${id}-state`} className="toggle-state">
          {checked ? "Habilitado" : "Desabilitado"}
        </span>
      </div>
      <span id={`${id}-hint`} className="field-hint">
        {hint}
      </span>
    </div>
  );
}
