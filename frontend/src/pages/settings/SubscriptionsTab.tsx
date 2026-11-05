import { useEffect, useState } from "react";
import * as subscriptionsApi from "../../api/subscriptions";
import type { Subscription } from "../../api/subscriptions";
import { SkeletonList } from "../../components/Skeleton";
import { useBranding } from "../../context/BrandingContext";
import { formatDateTime } from "../../utils/datetime";

const STATUS_LABELS: Record<string, string> = {
  ok: "Enviado",
  error: "Erro",
  skipped: "Pulado",
};

export default function SubscriptionsTab() {
  const { settings } = useBranding();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    subscriptionsApi
      .listAllSubscriptions()
      .then(setSubs)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = subs.filter((s) => {
    if (!filter) return true;
    const haystack = `${s.collection_name ?? ""} ${s.report_name} ${s.name ?? ""} ${s.created_by_name ?? ""} ${s.schedule_text}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as assinaturas.</p>;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Assinaturas de e-mail</h2>
      <p className="settings-section-desc">
        Todas as assinaturas ativas no sistema. Para criar, pausar ou excluir, abra o relatorio na tela
        cheia e clique em Assinar.
      </p>

      <input
        className="input"
        placeholder="Filtrar por colecao, relatorio, agenda..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 360 }}
      />

      {loading ? (
        <SkeletonList count={4} />
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          {subs.length === 0 ? "Nenhuma assinatura cadastrada ainda." : "Nenhuma assinatura encontrada."}
        </p>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colecao</th>
                <th>Relatorio</th>
                <th>Agenda</th>
                <th>Fuso</th>
                <th>Proximo envio</th>
                <th>Ultimo status</th>
                <th>Situacao</th>
                <th>Criado por</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.collection_name ?? "--"}</td>
                  <td>{s.report_name}</td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{s.schedule_text}</td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{s.timezone}</td>
                  <td style={{ fontSize: 13, whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                    {s.next_run_at ? formatDateTime(s.next_run_at, settings?.timezone) : "--"}
                  </td>
                  <td>
                    {s.last_status ? (
                      <span className={`badge${s.last_status === "error" ? " badge-error" : ""}`}>
                        {STATUS_LABELS[s.last_status] ?? s.last_status}
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>--</span>
                    )}
                    {s.consecutive_failures > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 12, color: "var(--color-error)" }}>
                        {s.consecutive_failures} falha{s.consecutive_failures > 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge${s.enabled ? "" : " badge-muted"}`}>
                      {s.enabled ? "Ativa" : "Pausada"}
                    </span>
                  </td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{s.created_by_name ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
