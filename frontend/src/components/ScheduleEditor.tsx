import { useEffect, useState } from "react";
import * as schedulesApi from "../api/schedules";
import type { ScheduleKind, ScheduleRange } from "../api/schedules";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";

const DAYS = [
  { label: "Seg", name: "Segunda-feira" },
  { label: "Ter", name: "Terça-feira" },
  { label: "Qua", name: "Quarta-feira" },
  { label: "Qui", name: "Quinta-feira" },
  { label: "Sex", name: "Sexta-feira" },
  { label: "Sáb", name: "Sábado" },
  { label: "Dom", name: "Domingo" },
];

const WORKDAYS_RANGE: ScheduleRange = { days: [0, 1, 2, 3, 4], start: "08:00", end: "18:00" };
const FULL_WEEK: ScheduleRange = { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "24:00" };

type UserMode = "groups" | "unlimited" | "ranges";

export function isUnlimited(ranges: ScheduleRange[]): boolean {
  return ranges.length === 1 && ranges[0].days.length === 7 && ranges[0].start === "00:00" && ranges[0].end === "24:00";
}

function modeOf(ranges: ScheduleRange[]): UserMode {
  if (ranges.length === 0) return "groups";
  return isUnlimited(ranges) ? "unlimited" : "ranges";
}

interface Props {
  kind: ScheduleKind;
  id: number;
  /** Quem só pode ver o horário (sem a permissão de definir): mostra tudo travado, sem Salvar */
  readOnly?: boolean;
}

/** Horário de acesso de um grupo ou de uma pessoa. No grupo, a lista de faixas vazia significa sem limite. Na pessoa, é
 * a exceção individual: com faixas (ou "sem limite") vale só ela, no lugar das dos grupos; sem nada, segue os grupos. */
export default function ScheduleEditor({ kind, id, readOnly = false }: Props) {
  const { showToast } = useToast();
  const [saved, setSaved] = useState<ScheduleRange[]>([]);
  const [draft, setDraft] = useState<ScheduleRange[]>([]);
  const [timezone, setTimezone] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // As faixas escolhidas ao passar para "sem limite" ou "seguir os grupos" não se perdem se a pessoa voltar atrás
  const [lastRanges, setLastRanges] = useState<ScheduleRange[]>([WORKDAYS_RANGE]);

  useEffect(() => {
    let cancelled = false;
    schedulesApi
      .getSchedule(kind, id)
      .then((schedule) => {
        if (cancelled) return;
        setSaved(schedule.ranges);
        setDraft(schedule.ranges);
        setTimezone(schedule.timezone);
        if (schedule.ranges.length > 0 && !isUnlimited(schedule.ranges)) setLastRanges(schedule.ranges);
        setLoadError(false);
      })
      .catch(() => !cancelled && setLoadError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const mode = modeOf(draft);

  function updateRange(index: number, patch: Partial<ScheduleRange>) {
    setDraft((current) => current.map((range, i) => (i === index ? { ...range, ...patch } : range)));
  }

  function toggleDay(index: number, day: number) {
    const days = draft[index].days;
    updateRange(index, { days: (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]).sort() });
  }

  function chooseMode(next: UserMode) {
    if (mode === "ranges") setLastRanges(draft);
    setDraft(next === "groups" ? [] : next === "unlimited" ? [FULL_WEEK] : lastRanges);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await schedulesApi.setSchedule(kind, id, draft);
      setSaved(result.ranges);
      setDraft(result.ranges);
      showToast("Horário de acesso salvo.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível salvar o horário.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="access-intro">Carregando o horário de acesso...</p>;
  if (loadError) return <p className="auth-error">Não foi possível carregar o horário de acesso.</p>;

  const showRanges = kind !== "user" || mode === "ranges";

  return (
    <section className="schedule-editor" aria-label="Horário de acesso">
      <h3 style={{ margin: 0, fontSize: 15 }}>Horário de acesso</h3>
      <p className="access-intro">
        {kind === "report"
          ? "Dias e horas em que este relatório pode ser aberto ou exportado. Sem nenhuma faixa, não há limite. Vale para todas as pessoas, menos para administradores, e soma-se ao horário de acesso de cada pessoa."
          : kind === "group"
          ? "Dias e horas em que as pessoas deste grupo podem usar o sistema. Sem nenhuma faixa, não há limite. Quem está em mais de um grupo com faixas entra quando qualquer um permitir. Administradores nunca são limitados."
          : "Por padrão a pessoa segue o horário dos grupos dela. Uma exceção aqui substitui o horário dos grupos, para mais ou para menos."}
      </p>

      {kind === "user" && (
        <fieldset className="schedule-modes" disabled={readOnly || saving}>
          <legend className="field-hint">Horário desta pessoa</legend>
          {(
            [
              ["groups", "Seguir o horário dos grupos"],
              ["unlimited", "Exceção: sem limite de horário"],
              ["ranges", "Exceção: faixas próprias"],
            ] as [UserMode, string][]
          ).map(([value, label]) => (
            <label key={value} className="schedule-mode">
              <input type="radio" name={`schedule-mode-${id}`} checked={mode === value} onChange={() => chooseMode(value)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {showRanges && (
        <fieldset className="schedule-ranges" disabled={readOnly || saving}>
          {draft.length === 0 && <p className="access-empty">Nenhuma faixa: sem limite de horário.</p>}
          {draft.map((range, index) => (
            <div key={index} className="schedule-range">
              <div className="schedule-days" role="group" aria-label={`Dias da faixa ${index + 1}`}>
                {DAYS.map((day, dayIndex) => {
                  const on = range.days.includes(dayIndex);
                  return (
                    <button
                      key={day.label}
                      type="button"
                      className={`schedule-day${on ? " schedule-day-on" : ""}`}
                      aria-pressed={on}
                      aria-label={day.name}
                      onClick={() => toggleDay(index, dayIndex)}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <div className="schedule-times">
                <label>
                  <span className="field-hint">Das</span>
                  <input
                    className="input"
                    type="time"
                    aria-label={`Início da faixa ${index + 1}`}
                    value={range.start}
                    onChange={(e) => updateRange(index, { start: e.target.value })}
                  />
                </label>
                <label>
                  <span className="field-hint">Às</span>
                  <input
                    className="input"
                    type="time"
                    aria-label={`Fim da faixa ${index + 1}`}
                    value={range.end === "24:00" ? "00:00" : range.end}
                    onChange={(e) => updateRange(index, { end: e.target.value === "00:00" ? "24:00" : e.target.value })}
                  />
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft((c) => c.filter((_, i) => i !== index))}>
                  Remover
                </button>
              </div>
            </div>
          ))}
          {!readOnly && draft.length < 20 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft((c) => [...c, { ...WORKDAYS_RANGE }])}>
              + Adicionar faixa
            </button>
          )}
        </fieldset>
      )}

      {timezone && <span className="field-hint">Os horários valem no fuso {timezone}, definido em Administração.</span>}

      {!readOnly && (
        <div>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "Salvando..." : "Salvar horário"}
          </button>
        </div>
      )}
    </section>
  );
}
