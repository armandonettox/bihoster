export interface SettingsRow {
  key: string;
  /** Nome da linha; também compõe o nome do botão ("Editar <nome>") */
  label: string;
  /** Uma frase dizendo o que essa parte controla */
  description: string;
  /** O estado atual em poucas palavras (ex.: "Cadastro aberto"), abaixo da descrição */
  summary?: string;
  /** A etiqueta da direita (ex.: "Personalizado", "Ligado") */
  status: string;
  /** Destaca a etiqueta: algo foi personalizado ou está ligado */
  highlight?: boolean;
  onEdit: () => void;
  disabled?: boolean;
}

/** A lista de partes de uma aba da Administração: uma linha por parte, cada uma com um botão que abre a janela de
 * edição. É o mesmo desenho da lista de e-mails e da lista da marca. */
export default function SettingsRowList({ rows }: { rows: SettingsRow[] }) {
  return (
    <ul className="email-template-list">
      {rows.map((row) => (
        <li key={row.key} className="email-template-row">
          <div className="email-template-text">
            <span className="email-template-name">{row.label}</span>
            <span className="field-hint">{row.description}</span>
            {row.summary && <span className="field-hint">{row.summary}</span>}
          </div>
          <span className={row.highlight ? "email-template-badge email-template-badge-custom" : "email-template-badge"}>
            {row.status}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-label={`Editar ${row.label}`}
            disabled={row.disabled}
            onClick={row.onEdit}
          >
            Editar
          </button>
        </li>
      ))}
    </ul>
  );
}
