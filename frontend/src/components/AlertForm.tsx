import { useState, type FormEvent } from "react";
import { ALERT_CONDITIONS, CONDITION_LABELS, type Alert, type AlertCondition, type AlertInput, type Measure } from "../api/alerts";

const MAX_RECIPIENTS = 20;

function parseRecipients(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

export default function AlertForm({
  initial,
  measures,
  loadingMeasures,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  initial: Alert | null;
  measures: Measure[];
  loadingMeasures: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (input: AlertInput) => void;
  onCancel: () => void;
}) {
  const firstMeasure = measures[0];
  const [name, setName] = useState(initial?.name ?? "");
  const [measureName, setMeasureName] = useState(initial?.measure_name ?? firstMeasure?.measure_name ?? "");
  const [tableName, setTableName] = useState(initial?.table_name ?? firstMeasure?.table_name ?? "");
  const [condition, setCondition] = useState<AlertCondition>(initial?.condition ?? ">");
  const [threshold, setThreshold] = useState(initial?.threshold?.toString() ?? "0");
  const [recipients, setRecipients] = useState((initial?.recipients ?? []).join("\n"));
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [intervalMin, setIntervalMin] = useState(initial?.check_interval_minutes?.toString() ?? "60");
  const [cooldownH, setCooldownH] = useState(initial?.cooldown_hours?.toString() ?? "24");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleMeasureChange(value: string) {
    setMeasureName(value);
    const found = measures.find((m) => m.measure_name === value);
    if (found) setTableName(found.table_name);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const list = parseRecipients(recipients);
    const thresholdNum = parseFloat(threshold);
    if (!measureName) return setLocalError("Selecione uma medida.");
    if (list.length === 0) return setLocalError("Informe ao menos um destinatario.");
    if (list.length > MAX_RECIPIENTS) return setLocalError(`No maximo ${MAX_RECIPIENTS} destinatarios.`);
    if (isNaN(thresholdNum)) return setLocalError("O valor limite deve ser um numero.");
    const intervalNum = parseInt(intervalMin, 10);
    const cooldownNum = parseInt(cooldownH, 10);
    if (isNaN(intervalNum) || intervalNum < 5) return setLocalError("Intervalo minimo: 5 minutos.");
    if (isNaN(cooldownNum) || cooldownNum < 1) return setLocalError("Cooldown minimo: 1 hora.");
    setLocalError(null);
    onSubmit({
      name: name.trim() || null,
      measure_name: measureName,
      table_name: tableName || null,
      condition,
      threshold: thresholdNum,
      recipients: list,
      subject: subject.trim() || null,
      message: message.trim() || null,
      check_interval_minutes: intervalNum,
      cooldown_hours: cooldownNum,
    });
  }

  const shownError = localError ?? error;

  return (
    <form onSubmit={handleSubmit}>
      <label className="field">
        Nome do alerta (opcional)
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="field" style={{ marginTop: 12 }}>
        Medida monitorada
        {loadingMeasures ? (
          <p style={{ margin: "4px 0", fontSize: 13, color: "var(--color-text-muted)" }}>Carregando medidas...</p>
        ) : measures.length === 0 ? (
          <p style={{ margin: "4px 0", fontSize: 13, color: "var(--color-danger)" }}>
            Nenhuma medida encontrada. Verifique a conexao com o Power BI.
          </p>
        ) : (
          <select className="input" value={measureName} onChange={(e) => handleMeasureChange(e.target.value)}>
            {measures.map((m) => (
              <option key={`${m.table_name}/${m.measure_name}`} value={m.measure_name}>
                {m.table_name ? `${m.table_name} / ${m.measure_name}` : m.measure_name}
              </option>
            ))}
          </select>
        )}
      </label>

      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "0 0 160px" }}>
          Condicao
          <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}>
            {ALERT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c} ({CONDITION_LABELS[c]})
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          Valor limite
          <input
            className="input"
            type="number"
            step="any"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        Destinatarios
        <textarea
          className="input"
          rows={3}
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="um e-mail por linha, ou separados por virgula"
        />
      </label>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          Verificar a cada (minutos)
          <input
            className="input"
            type="number"
            min={5}
            max={1440}
            value={intervalMin}
            onChange={(e) => setIntervalMin(e.target.value)}
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Cooldown (horas)
          <input
            className="input"
            type="number"
            min={1}
            max={720}
            value={cooldownH}
            onChange={(e) => setCooldownH(e.target.value)}
          />
          <span style={{ fontWeight: 400, fontSize: 12 }}>Intervalo minimo entre disparos.</span>
        </label>
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        Assunto do e-mail (opcional)
        <input className="input" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        Mensagem adicional (opcional)
        <textarea
          className="input"
          rows={3}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>

      {shownError && (
        <p className="auth-error" role="alert">
          {shownError}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button type="submit" className="btn btn-primary" disabled={saving || loadingMeasures}>
          {saving ? "Salvando..." : initial ? "Salvar" : "Criar alerta"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
