import type { AuditSummary, DashboardWidget } from "../../../api/audit";
import { BarList, Donut, HourChart, LineChart } from "../charts";
import { STAT_META, widgetTitle } from "./widgetMeta";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

function hintFor(widget: DashboardWidget, summary: AuditSummary): string | undefined {
  if (widget.source === "by_hour") return `Eventos por hora do dia (${summary.timezone})`;
  if (widget.source === "top_reports") return "Cada abertura conta uma vez a cada 10 minutos por pessoa";
  return undefined;
}

function Body({ widget, summary }: { widget: DashboardWidget; summary: AuditSummary }) {
  switch (widget.source) {
    case "by_day":
      return (
        <LineChart
          data={summary.by_day.map((d) => ({ label: d.date, value: d.count }))}
          describe={(n) => plural(n, "evento", "eventos")}
        />
      );
    case "by_hour":
      return <HourChart values={summary.by_hour} describe={(hour, n) => `${hour}h: ${plural(n, "evento", "eventos")}`} />;
    case "by_action":
      return summary.by_action.length === 0 ? (
        <p className="audit-empty">Sem dados.</p>
      ) : (
        <BarList
          items={summary.by_action.map((a) => ({ key: a.action, label: a.label, value: a.count }))}
          unit={(n) => n.toLocaleString("pt-BR")}
        />
      );
    case "top_users":
      return summary.top_users.length === 0 ? (
        <p className="audit-empty">Sem dados.</p>
      ) : (
        <BarList
          items={summary.top_users.map((u) => ({ key: String(u.user_id), label: u.name, value: u.count, hint: u.email ?? undefined }))}
          unit={(n) => plural(n, "evento", "eventos")}
        />
      );
    case "top_collections":
      return summary.top_collections.length === 0 ? (
        <p className="audit-empty">Nenhuma visita registrada.</p>
      ) : (
        <BarList
          items={summary.top_collections.map((c) => ({ key: String(c.workspace_id), label: c.name, value: c.visits }))}
          unit={(n) => plural(n, "visita", "visitas")}
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
        />
      );
    default:
      return <p className="audit-empty">Este visual nao e conhecido nesta versao.</p>;
  }
}

interface Props {
  widget: DashboardWidget;
  summary: AuditSummary;
  /** No modo de edicao o cabecalho vira a alca de arrastar */
  editing: boolean;
}

/** Um visual do painel, desenhado a partir do resumo da auditoria. Ocupa todo o espaco que a grade deu. */
export default function WidgetView({ widget, summary, editing }: Props) {
  const dragClass = editing ? "dash-drag" : "";

  if (widget.type === "stat") {
    const meta = STAT_META[widget.source];
    const value = (summary.totals as unknown as Record<string, number>)[widget.source] ?? 0;
    const danger = meta?.danger && value > 0;
    return (
      <div className={`audit-stat dash-fill ${danger ? "audit-stat-danger" : ""} ${dragClass}`}>
        <span className="material-symbols-outlined audit-stat-icon" aria-hidden="true">{meta?.icon ?? "analytics"}</span>
        <div>
          <div className="audit-stat-value">{value.toLocaleString("pt-BR")}</div>
          <div className="audit-stat-label">{widgetTitle(widget)}</div>
        </div>
      </div>
    );
  }

  const hint = hintFor(widget, summary);
  return (
    <section className="audit-panel dash-fill">
      <header className={`dash-header ${dragClass}`}>
        {editing && (
          <span className="material-symbols-outlined dash-grip" aria-hidden="true">drag_indicator</span>
        )}
        <h3>{widgetTitle(widget)}</h3>
      </header>
      {hint && <p className="audit-panel-hint">{hint}</p>}
      <div className="dash-body">
        <Body widget={widget} summary={summary} />
      </div>
    </section>
  );
}
