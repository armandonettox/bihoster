import { useEffect, useState } from "react";
import {
  queryAudit,
  type AuditFilters,
  type AuditQueryResult,
  type AuditSummary,
  type DashboardWidget,
  type WidgetQuery,
} from "../../../api/audit";
import { shortDate } from "../../../utils/auditPeriod";
import { BarList, Donut, HourChart, LineChart } from "../charts";
import { isFilterable, isStatSelected, patchForKey, patchForStat, selectedKeys, type FilterPatch } from "./interactions";
import { STAT_META, widgetTitle } from "./widgetMeta";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

// Cores das fatias da rosca: as do tema primeiro, depois duas fixas para quando ha mais categorias
const DONUT_COLORS = [
  "var(--color-primary-text)",
  "var(--color-accent)",
  "var(--color-secondary)",
  "var(--color-danger)",
  "#e0a030",
  "#8e6bbf",
  "var(--color-text-muted)",
  "#4da3a0",
];

function hintFor(widget: DashboardWidget, summary: AuditSummary | null): string | undefined {
  if (widget.source === "by_hour" && summary) return `Eventos por hora do dia (${summary.timezone})`;
  if (widget.source === "top_reports") return "Cada abertura conta uma vez a cada 10 minutos por pessoa";
  return undefined;
}

/** O que os graficos recebem para filtrar ao clicar: sem onSelect o visual so mostra o rotulo */
interface ItemPick {
  onSelect?: (key: string) => void;
  selected: string[];
}

type QueryState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; data: AuditQueryResult };

/** Busca o numero ou a serie de um visual personalizado; busca de novo quando a consulta ou os filtros mudam. */
function useQueryResult(query: WidgetQuery | null, filters: AuditFilters): QueryState {
  const key = query ? JSON.stringify([query, filters]) : "";
  const [result, setResult] = useState<{ key: string; data?: AuditQueryResult; failed?: boolean } | null>(null);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    queryAudit(filters, query)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch(() => !cancelled && setResult({ key, failed: true }));
    return () => {
      cancelled = true;
    };
    // key ja resume a consulta e os filtros
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!query) return { status: "none" };
  if (result?.key !== key) return { status: "loading" };
  if (result.failed || !result.data) return { status: "failed" };
  return { status: "ready", data: result.data };
}

function CustomBody({ widget, state, pick }: { widget: DashboardWidget; state: QueryState; pick: ItemPick }) {
  if (state.status === "loading") return <p className="audit-empty">Carregando...</p>;
  if (state.status !== "ready") return <p className="audit-empty" role="alert">Nao foi possivel carregar este visual.</p>;

  const { rows, metric_label, group_by } = state.data;
  if (rows.length === 0 || rows.every((r) => r.value === 0) && widget.type !== "line") {
    return <p className="audit-empty">Sem dados.</p>;
  }

  const unit = (n: number) => n.toLocaleString("pt-BR");
  switch (widget.type) {
    case "line":
      return (
        <LineChart
          data={rows.map((r) => ({ label: group_by === "day" ? r.key : r.label, value: r.value }))}
          formatLabel={group_by === "day" ? shortDate : (label) => label}
          describe={(n) => `${unit(n)} ${metric_label.toLowerCase()}`}
          {...pick}
        />
      );
    case "bars":
      return <BarList items={rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))} unit={unit} {...pick} />;
    case "donut":
      return (
        <Donut
          centerLabel={metric_label.toLowerCase()}
          emptyText="Sem dados."
          parts={rows.map((r, i) => ({ key: r.key, label: r.label, value: r.value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))}
          {...pick}
        />
      );
    case "table":
      return (
        <table className="table audit-widget-table">
          <thead>
            <tr>
              <th>{group_by === "day" ? "Dia" : "Item"}</th>
              <th>{metric_label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={`${pick.onSelect ? "chart-clickable" : ""} ${pick.selected.includes(r.key) ? "chart-selected" : ""}`.trim()}
                title={pick.onSelect ? (pick.selected.includes(r.key) ? "Clique para tirar o filtro" : "Clique para filtrar") : undefined}
                onClick={pick.onSelect ? () => pick.onSelect?.(r.key) : undefined}
              >
                <td>{group_by === "day" ? shortDate(r.key) : r.label}</td>
                <td>{unit(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return <p className="audit-empty">Este visual nao e conhecido nesta versao.</p>;
  }
}

function SummaryBody({ widget, summary, pick }: { widget: DashboardWidget; summary: AuditSummary | null; pick: ItemPick }) {
  if (!summary) return <p className="audit-empty">Sem dados.</p>;
  switch (widget.source) {
    case "by_day":
      return (
        <LineChart
          data={summary.by_day.map((d) => ({ label: d.date, value: d.count }))}
          describe={(n) => plural(n, "evento", "eventos")}
          {...pick}
        />
      );
    case "by_hour":
      return <HourChart values={summary.by_hour} describe={(_hour, n) => plural(n, "evento", "eventos")} />;
    case "by_action":
      return summary.by_action.length === 0 ? (
        <p className="audit-empty">Sem dados.</p>
      ) : (
        <BarList
          items={summary.by_action.map((a) => ({ key: a.action, label: a.label, value: a.count }))}
          unit={(n) => n.toLocaleString("pt-BR")}
          {...pick}
        />
      );
    case "top_users":
      return summary.top_users.length === 0 ? (
        <p className="audit-empty">Sem dados.</p>
      ) : (
        <BarList
          items={summary.top_users.map((u) => ({ key: String(u.user_id), label: u.name, value: u.count, hint: u.email ?? undefined }))}
          unit={(n) => plural(n, "evento", "eventos")}
          {...pick}
        />
      );
    case "top_collections":
      return summary.top_collections.length === 0 ? (
        <p className="audit-empty">Nenhuma visita registrada.</p>
      ) : (
        <BarList
          items={summary.top_collections.map((c) => ({ key: String(c.workspace_id), label: c.name, value: c.visits }))}
          unit={(n) => plural(n, "visita", "visitas")}
          {...pick}
        />
      );
    case "top_reports":
      return summary.top_reports.length === 0 ? (
        <p className="audit-empty">Nenhuma abertura registrada.</p>
      ) : (
        <BarList
          items={summary.top_reports.map((r) => ({
            key: r.report_id,
            label: r.name,
            value: r.visits,
            hint: r.collection ? `Colecao: ${r.collection}` : undefined,
          }))}
          unit={(n) => plural(n, "abertura", "aberturas")}
          {...pick}
        />
      );
    case "login_methods":
      return (
        <Donut
          centerLabel="logins"
          emptyText="Nenhum login no periodo."
          parts={[
            { key: "password", label: "Email e senha", value: summary.login_methods.password, color: "var(--color-primary-text)" },
            { key: "google", label: "Google", value: summary.login_methods.google, color: "var(--color-accent)" },
          ]}
          {...pick}
        />
      );
    default:
      return <p className="audit-empty">Este visual nao e conhecido nesta versao.</p>;
  }
}

interface Props {
  widget: DashboardWidget;
  /** Resumo da auditoria: alimenta os visuais padrao. Os personalizados buscam o proprio dado. */
  summary: AuditSummary | null;
  /** Filtros da pagina, que valem tambem para os visuais personalizados */
  filters?: AuditFilters;
  /** No modo de edicao o cabecalho vira a alca de arrastar e aparecem os botoes de configurar e remover */
  editing: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  /** Clicar num item do visual pede este filtro a pagina. No modo de edicao o clique nao filtra. */
  onFilterBy?: (patch: FilterPatch) => void;
}

/** Um visual do painel. Ocupa todo o espaco que a grade deu. */
export default function WidgetView({ widget, summary, filters = {}, editing, onEdit, onRemove, onFilterBy }: Props) {
  const state = useQueryResult(widget.query, filters);
  const interactive = !editing && onFilterBy !== undefined;
  const pick: ItemPick = {
    onSelect:
      interactive && isFilterable(widget)
        ? (key) => {
            const patch = patchForKey(widget, key);
            if (patch) onFilterBy?.(patch);
          }
        : undefined,
    selected: selectedKeys(widget, filters),
  };
  const dragClass = editing ? "dash-drag" : "";
  const colorClass = widget.color ? `dash-color-${widget.color}` : "";
  const title = widgetTitle(widget);

  const actions = editing ? (
    <div className="dash-actions">
      <button type="button" className="dash-action" aria-label={`Configurar ${title}`} title="Configurar" onClick={onEdit}>
        <span className="material-symbols-outlined" aria-hidden="true">tune</span>
      </button>
      <button type="button" className="dash-action" aria-label={`Remover ${title}`} title="Remover" onClick={onRemove}>
        <span className="material-symbols-outlined" aria-hidden="true">delete</span>
      </button>
    </div>
  ) : null;

  if (widget.type === "stat") {
    const meta = STAT_META[widget.source];
    const value = widget.query
      ? state.status === "ready"
        ? state.data.total
        : null
      : ((summary?.totals as unknown as Record<string, number> | undefined)?.[widget.source] ?? 0);
    const danger = meta?.danger && (value ?? 0) > 0;
    const statPatch = interactive ? patchForStat(widget) : null;
    const statSelected = isStatSelected(widget, filters);
    return (
      <div
        className={`audit-stat dash-fill ${danger ? "audit-stat-danger" : ""} ${colorClass} ${dragClass} ${statPatch ? "chart-clickable" : ""} ${statSelected ? "chart-selected" : ""}`}
        {...(statPatch
          ? {
              role: "button",
              tabIndex: 0,
              title: statSelected ? "Clique para tirar o filtro" : "Clique para filtrar",
              onClick: () => onFilterBy?.(statPatch),
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onFilterBy?.(statPatch);
                }
              },
            }
          : {})}
      >
        <span className="material-symbols-outlined audit-stat-icon" aria-hidden="true">{meta?.icon ?? "analytics"}</span>
        <div>
          <div className="audit-stat-value">
            {value === null ? (state.status === "failed" ? "--" : "...") : value.toLocaleString("pt-BR")}
          </div>
          <div className="audit-stat-label">{title}</div>
        </div>
        {actions}
      </div>
    );
  }

  const hint = hintFor(widget, summary);
  return (
    <section className={`audit-panel dash-fill ${colorClass}`}>
      <header className={`dash-header ${dragClass}`}>
        {editing && <span className="material-symbols-outlined dash-grip" aria-hidden="true">drag_indicator</span>}
        <h3>{title}</h3>
        {actions}
      </header>
      {hint && <p className="audit-panel-hint">{hint}</p>}
      <div className="dash-body">
        {widget.query ? (
          <CustomBody widget={widget} state={state} pick={pick} />
        ) : (
          <SummaryBody widget={widget} summary={summary} pick={pick} />
        )}
      </div>
    </section>
  );
}
