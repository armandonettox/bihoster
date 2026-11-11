import { useEffect, useState } from "react";
import { getAuditSummary, type AuditFilters, type AuditSummary } from "../../api/audit";
import { SkeletonList } from "../Skeleton";
import { BarList, Donut, HourChart, LineChart } from "./charts";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

interface StatProps {
  icon: string;
  label: string;
  value: number;
  tone?: "default" | "danger";
}

function StatCard({ icon, label, value, tone = "default" }: StatProps) {
  const danger = tone === "danger" && value > 0;
  return (
    <div className={`audit-stat ${danger ? "audit-stat-danger" : ""}`}>
      <span className="material-symbols-outlined audit-stat-icon" aria-hidden="true">{icon}</span>
      <div>
        <div className="audit-stat-value">{value.toLocaleString("pt-BR")}</div>
        <div className="audit-stat-label">{label}</div>
      </div>
    </div>
  );
}

function Panel({ title, hint, children, wide }: { title: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`audit-panel ${wide ? "audit-panel-wide" : ""}`}>
      <h3>{title}</h3>
      {hint && <p className="audit-panel-hint">{hint}</p>}
      {children}
    </section>
  );
}

type Result = { key: string; data?: AuditSummary; failed?: boolean };

/** Aba Analiticos: cartoes e graficos com os mesmos filtros da tabela. */
export default function AuditAnalytics({ filters }: { filters: AuditFilters }) {
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    getAuditSummary(filters)
      .then((data) => !cancelled && setResult({ key: requestKey, data }))
      .catch(() => !cancelled && setResult({ key: requestKey, failed: true }));
    return () => {
      cancelled = true;
    };
    // requestKey ja resume os filtros
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (result?.key !== requestKey) return <SkeletonList count={4} />;
  if (result.failed || !result.data) {
    return <p className="audit-empty" role="alert">Nao foi possivel carregar os analiticos.</p>;
  }

  const s = result.data;
  const noData = s.totals.events === 0;

  return (
    <div>
      <div className="audit-stats">
        <StatCard icon="list_alt" label="Eventos" value={s.totals.events} />
        <StatCard icon="group" label="Pessoas ativas" value={s.totals.active_users} />
        <StatCard icon="login" label="Logins" value={s.totals.logins_ok} />
        <StatCard icon="lock" label="Logins bloqueados" value={s.totals.logins_blocked} tone="danger" />
        <StatCard icon="lock_clock" label="Contas travadas" value={s.totals.accounts_locked} tone="danger" />
      </div>

      {noData && <p className="audit-empty">Nenhum evento nesse periodo e com esses filtros.</p>}

      <div className="audit-panels">
        <Panel title="Eventos por dia" wide>
          <LineChart
            data={s.by_day.map((d) => ({ label: d.date, value: d.count }))}
            describe={(n) => plural(n, "evento", "eventos")}
          />
        </Panel>

        <Panel title="Acoes mais frequentes">
          {s.by_action.length === 0 ? (
            <p className="audit-empty">Sem dados.</p>
          ) : (
            <BarList
              items={s.by_action.map((a) => ({ key: a.action, label: a.label, value: a.count }))}
              unit={(n) => n.toLocaleString("pt-BR")}
            />
          )}
        </Panel>

        <Panel title="Horario de pico" hint={`Eventos por hora do dia (${s.timezone})`}>
          <HourChart values={s.by_hour} describe={(hour, n) => `${hour}h: ${plural(n, "evento", "eventos")}`} />
        </Panel>

        <Panel title="Pessoas mais ativas">
          {s.top_users.length === 0 ? (
            <p className="audit-empty">Sem dados.</p>
          ) : (
            <BarList
              items={s.top_users.map((u) => ({ key: String(u.user_id), label: u.name, value: u.count, hint: u.email ?? undefined }))}
              unit={(n) => plural(n, "evento", "eventos")}
            />
          )}
        </Panel>

        <Panel title="Colecoes mais visitadas">
          {s.top_collections.length === 0 ? (
            <p className="audit-empty">Nenhuma visita registrada.</p>
          ) : (
            <BarList
              items={s.top_collections.map((c) => ({ key: String(c.workspace_id), label: c.name, value: c.visits }))}
              unit={(n) => plural(n, "visita", "visitas")}
            />
          )}
        </Panel>

        <Panel title="Relatorios mais visitados" hint="Cada abertura conta uma vez a cada 10 minutos por pessoa">
          {s.top_reports.length === 0 ? (
            <p className="audit-empty">Nenhuma abertura registrada.</p>
          ) : (
            <BarList
              items={s.top_reports.map((r) => ({
                key: r.report_id,
                label: r.name,
                value: r.visits,
                hint: r.collection ? `Colecao: ${r.collection}` : undefined,
              }))}
              unit={(n) => plural(n, "abertura", "aberturas")}
            />
          )}
        </Panel>

        <Panel title="Logins por metodo">
          <Donut
            centerLabel="logins"
            emptyText="Nenhum login no periodo."
            parts={[
              { key: "password", label: "Email e senha", value: s.login_methods.password, color: "var(--color-primary-text)" },
              { key: "google", label: "Google", value: s.login_methods.google, color: "var(--color-accent)" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
