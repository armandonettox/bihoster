import type { AuditOptions } from "../../api/audit";
import MultiSelect from "../MultiSelect";
import { DEFAULT_FILTERS, type AuditFilterState } from "../../utils/auditFilterState";
import { PERIOD_OPTIONS, type AuditPeriod } from "../../utils/auditPeriod";

interface Props {
  value: AuditFilterState;
  options: AuditOptions | null;
  onChange: (next: AuditFilterState) => void;
}

/** Filtros compartilhados pelas duas abas: periodo, pessoa, acao e colecao. */
export default function AuditFilters({ value, options, onChange }: Props) {
  const set = (patch: Partial<AuditFilterState>) => onChange({ ...value, ...patch });
  const changed =
    value.period !== DEFAULT_FILTERS.period ||
    value.userIds.length > 0 ||
    value.actions.length > 0 ||
    value.entities.length > 0 ||
    value.workspaceIds.length > 0 ||
    value.reportIds.length > 0;

  return (
    <div className="audit-filters">
      <div className="audit-selects">
        <label>
          Periodo
          <select
            className="input"
            value={value.period}
            onChange={(e) => set({ period: e.target.value as AuditPeriod })}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {value.period === "custom" && (
          <>
            <label>
              De
              <input
                className="input"
                type="date"
                value={value.customFrom}
                max={value.customTo || undefined}
                onChange={(e) => set({ customFrom: e.target.value })}
              />
            </label>
            <label>
              Ate
              <input
                className="input"
                type="date"
                value={value.customTo}
                min={value.customFrom || undefined}
                onChange={(e) => set({ customTo: e.target.value })}
              />
            </label>
          </>
        )}
        <MultiSelect
          label="Pessoa"
          options={(options?.users ?? []).map((u) => ({ value: String(u.id), label: u.name, hint: u.email }))}
          selected={value.userIds}
          onChange={(userIds) => set({ userIds })}
        />
        <MultiSelect
          label="Acao"
          options={(options?.actions ?? []).map((a) => ({ value: a.action, label: a.label }))}
          selected={value.actions}
          onChange={(actions) => set({ actions })}
        />
        <MultiSelect
          label="Recurso"
          options={(options?.entities ?? []).map((e) => ({ value: e.entity, label: e.label }))}
          selected={value.entities}
          onChange={(entities) => set({ entities })}
        />
        <MultiSelect
          label="Colecao"
          options={(options?.collections ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          selected={value.workspaceIds}
          onChange={(workspaceIds) => set({ workspaceIds })}
        />
        <MultiSelect
          label="Relatorio"
          options={(options?.reports ?? []).map((r) => ({
            value: String(r.id),
            label: r.name,
            hint: r.collection ? `Colecao: ${r.collection}` : undefined,
          }))}
          selected={value.reportIds}
          onChange={(reportIds) => set({ reportIds })}
        />
        {changed && (
          <button type="button" className="btn btn-ghost audit-clear" onClick={() => onChange(DEFAULT_FILTERS)}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">filter_alt_off</span>
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
