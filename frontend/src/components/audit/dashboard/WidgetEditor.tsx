import { useState } from "react";
import type { AuditFilters, AuditSummary, DashboardWidget, GroupBy, Metric, WidgetColor, WidgetType } from "../../../api/audit";
import Modal from "../../Modal";
import {
  COLOR_OPTIONS,
  COLORABLE_TYPES,
  DEFAULT_SIZE,
  GROUP_OPTIONS,
  METRIC_OPTIONS,
  TYPE_OPTIONS,
  defaultTitle,
  groupsFor,
} from "./widgetCatalog";
import WidgetView from "./WidgetView";

const LIMIT_OPTIONS = [5, 8, 10, 15, 20];
// Agrupamentos em que "quantos itens" faz sentido (dia, hora e dia da semana mostram todos)
const CATEGORY_GROUPS: GroupBy[] = ["action", "entity", "user", "collection", "report", "login_method"];

/** Identificador novo para um visual (letras e numeros, como o servidor exige). */
function newWidgetId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface Props {
  /** Visual que esta sendo configurado; sem ele, e um visual novo */
  initial?: DashboardWidget;
  filters: AuditFilters;
  summary: AuditSummary | null;
  onSave: (widget: DashboardWidget) => void;
  onClose: () => void;
}

/** Janela para montar um visual novo (tipo, o que medir, como agrupar, titulo e cor) ou configurar
 * um existente. Visual padrao so aceita titulo e cor; a pre-visualizacao usa os filtros da pagina. */
export default function WidgetEditor({ initial, filters, summary, onSave, onClose }: Props) {
  const isBuiltIn = initial !== undefined && !initial.query;
  const [type, setType] = useState<WidgetType>(initial?.type ?? "bars");
  const [metric, setMetric] = useState<Metric>(initial?.query?.metric ?? "events");
  const [group, setGroup] = useState<GroupBy>(initial?.query?.group_by ?? "action");
  const [limit, setLimit] = useState(initial?.query?.limit ?? 8);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [color, setColor] = useState<WidgetColor | null>(initial?.color ?? null);

  const groups = groupsFor(type, metric);
  const colorable = COLORABLE_TYPES.includes(type);
  const showLimit = !isBuiltIn && CATEGORY_GROUPS.includes(group) && (type === "bars" || type === "donut" || type === "table");

  function chooseType(next: WidgetType) {
    setType(next);
    const allowed = groupsFor(next, metric);
    if (!allowed.includes(group)) setGroup(allowed[0]);
  }

  function chooseMetric(next: Metric) {
    setMetric(next);
    const allowed = groupsFor(type, next);
    if (!allowed.includes(group)) setGroup(allowed[0]);
  }

  const draft: DashboardWidget = isBuiltIn
    ? { ...initial, title: title.trim() || null, color: colorable ? color : null }
    : {
        id: initial?.id ?? "preview",
        type,
        source: "custom",
        title: title.trim() || null,
        color: colorable ? color : null,
        query: { metric, group_by: group, limit },
        x: initial?.x ?? 0,
        y: initial?.y ?? 0,
        w: initial?.w ?? DEFAULT_SIZE[type].w,
        h: initial?.h ?? DEFAULT_SIZE[type].h,
      };

  function save() {
    onSave(draft.id === "preview" ? { ...draft, id: newWidgetId() } : draft);
  }

  return (
    <Modal title={initial ? "Configurar visual" : "Novo visual"} onClose={onClose} wide>
      <div className="editor">
        <div className="editor-form">
          {isBuiltIn ? (
            <p className="editor-note">
              Este e um visual padrao: voce pode mudar o titulo e a cor. Para outro tipo de numero, adicione um visual novo.
            </p>
          ) : (
            <>
              <div className="editor-field">
                <span className="editor-label" id="editor-type-label">Tipo de visual</span>
                <div className="editor-types" role="radiogroup" aria-labelledby="editor-type-label">
                  {TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={type === option.value}
                      className={`editor-type ${type === option.value ? "editor-type-active" : ""}`}
                      onClick={() => chooseType(option.value)}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">{option.icon}</span>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="editor-field">
                <span className="editor-label">O que medir</span>
                <select className="input" value={metric} onChange={(e) => chooseMetric(e.target.value as Metric)}>
                  {METRIC_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field">
                <span className="editor-label">Agrupar por</span>
                <select
                  className="input"
                  value={group}
                  disabled={groups.length === 1}
                  onChange={(e) => setGroup(e.target.value as GroupBy)}
                >
                  {GROUP_OPTIONS.filter((option) => groups.includes(option.value)).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {showLimit && (
                <label className="editor-field">
                  <span className="editor-label">Quantos itens</span>
                  <select className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                    {LIMIT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <label className="editor-field">
            <span className="editor-label">Titulo</span>
            <input
              className="input"
              value={title}
              maxLength={80}
              placeholder={isBuiltIn ? undefined : defaultTitle(metric, isBuiltIn ? "none" : group)}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          {colorable && (
            <div className="editor-field">
              <span className="editor-label" id="editor-color-label">Cor</span>
              <div className="editor-colors" role="radiogroup" aria-labelledby="editor-color-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={color === null}
                  aria-label="Cor padrao"
                  title="Cor padrao"
                  className={`editor-color editor-color-default ${color === null ? "editor-color-active" : ""}`}
                  onClick={() => setColor(null)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">format_color_reset</span>
                </button>
                {COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={color === option.value}
                    aria-label={option.label}
                    title={option.label}
                    className={`editor-color ${color === option.value ? "editor-color-active" : ""}`}
                    style={{ backgroundColor: option.css }}
                    onClick={() => setColor(option.value)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {!isBuiltIn && (
          <div className="editor-preview" aria-label="Pre-visualizacao">
            <span className="editor-label">Pre-visualizacao</span>
            <div className="editor-preview-box">
              <WidgetView widget={draft} summary={summary} filters={filters} editing={false} />
            </div>
          </div>
        )}
      </div>

      <div className="flex-row gap-sm">
        <button className="btn btn-primary" onClick={save}>
          {initial ? "Aplicar" : "Adicionar visual"}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
