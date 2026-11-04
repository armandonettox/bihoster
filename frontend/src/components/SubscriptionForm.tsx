import { useState, type FormEvent } from "react";
import type { Subscription, SubscriptionFormat, SubscriptionInput } from "../api/subscriptions";

const WEEK_DAYS = [
  { value: 0, label: "Seg" },
  { value: 1, label: "Ter" },
  { value: 2, label: "Qua" },
  { value: 3, label: "Qui" },
  { value: 4, label: "Sex" },
  { value: 5, label: "Sab" },
  { value: 6, label: "Dom" },
];
const MAX_TIMES = 6;
const MAX_RECIPIENTS = 20;

/** Separa os destinatarios digitados por virgula, ponto e virgula, espaco ou quebra de linha */
function parseRecipients(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));
}

/** Formulario de criar ou editar uma assinatura. Valida o basico aqui; o servidor valida de novo. */
export default function SubscriptionForm({
  initial,
  allowedDomains,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  initial: Subscription | null;
  allowedDomains: string[];
  saving: boolean;
  error: string | null;
  onSubmit: (input: SubscriptionInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [recipients, setRecipients] = useState((initial?.recipients ?? []).join("\n"));
  const [format, setFormat] = useState<SubscriptionFormat>(initial?.format ?? "PDF");
  const [days, setDays] = useState<number[]>(initial?.days ?? [0, 1, 2, 3, 4]);
  const [times, setTimes] = useState<string[]>(initial?.times ?? ["08:00"]);
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function toggleDay(day: number) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const list = parseRecipients(recipients);
    const filledTimes = Array.from(new Set(times.filter(Boolean))).sort();
    if (list.length === 0) return setLocalError("Informe ao menos um destinatario.");
    if (list.length > MAX_RECIPIENTS) return setLocalError(`No maximo ${MAX_RECIPIENTS} destinatarios.`);
    if (days.length === 0) return setLocalError("Escolha ao menos um dia da semana.");
    if (filledTimes.length === 0) return setLocalError("Informe ao menos um horario.");
    if (startDate && endDate && endDate < startDate) return setLocalError("A data final vem antes da inicial.");
    setLocalError(null);
    onSubmit({
      name: name.trim() || null,
      recipients: list,
      format,
      days,
      times: filledTimes,
      start_date: startDate || null,
      end_date: endDate || null,
      subject: subject.trim() || null,
      message: message.trim() || null,
    });
  }

  const shownError = localError ?? error;

  return (
    <form onSubmit={handleSubmit}>
      <label className="field">
        Nome da assinatura (opcional)
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>

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
      {allowedDomains.length > 0 && (
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
          So sao aceitos e-mails de: {allowedDomains.join(", ")}
        </p>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        Formato
        <select className="input" value={format} onChange={(e) => setFormat(e.target.value as SubscriptionFormat)}>
          <option value="PDF">PDF</option>
          <option value="PNG">Imagem (PNG)</option>
        </select>
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-muted)", marginBottom: 6 }}>
          Dias da semana
        </legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {WEEK_DAYS.map((d) => (
            <label key={d.value} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={days.includes(d.value)} onChange={() => toggleDay(d.value)} />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-muted)", marginBottom: 6 }}>
          Horarios
        </legend>
        {times.map((time, index) => (
          <div key={index} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input
              className="input"
              type="time"
              aria-label={`Horario ${index + 1}`}
              value={time}
              style={{ width: 140 }}
              onChange={(e) => setTimes((cur) => cur.map((t, i) => (i === index ? e.target.value : t)))}
            />
            {times.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remover horario ${index + 1}`}
                onClick={() => setTimes((cur) => cur.filter((_, i) => i !== index))}
              >
                Remover
              </button>
            )}
          </div>
        ))}
        {times.length < MAX_TIMES && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTimes((cur) => [...cur, "12:00"])}>
            Adicionar horario
          </button>
        )}
      </fieldset>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          Comeca em (opcional)
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Termina em (opcional)
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        Assunto (opcional)
        <input className="input" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        Mensagem (opcional)
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
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Salvando..." : initial ? "Salvar" : "Criar assinatura"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
