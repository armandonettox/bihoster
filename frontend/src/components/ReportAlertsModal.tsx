import { type RefObject, useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../api/client";
import * as alertsApi from "../api/alerts";
import type { Alert, AlertInput, Measure } from "../api/alerts";
import type { Report } from "../api/reports";
import { formatDateTime } from "../utils/datetime";
import type { ReportEmbedHandle } from "./ReportEmbed";
import AlertForm from "./AlertForm";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";

const STATUS_COLOR: Record<string, string> = {
  ok: "var(--color-success, #22c55e)",
  error: "var(--color-danger)",
  skipped: "var(--color-text-muted)",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Disparado",
  error: "Erro",
  skipped: "Aguardando",
};

export default function ReportAlertsModal({
  report,
  workspaceId,
  embedRef,
  onClose,
}: {
  report: Report;
  workspaceId: number;
  embedRef: RefObject<ReportEmbedHandle | null>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Alert[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [loadingMeasures, setLoadingMeasures] = useState(false);
  const [editing, setEditing] = useState<Alert | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Alert | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await alertsApi.listReportAlerts(workspaceId, report.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err) || "Nao foi possivel carregar os alertas.");
    }
  }, [workspaceId, report.id]);

  useEffect(() => {
    load();
  }, [load]);

  const [measuresError, setMeasuresError] = useState<string | null>(null);

  useEffect(() => {
    if (!embedRef.current) return;
    setLoadingMeasures(true);
    setMeasuresError(null);
    embedRef.current
      .getPageMeasures()
      .then((data) => {
        const asMeasures: Measure[] = data.map((m) => ({ measure_name: m.measure_name, table_name: m.table_name }));
        setMeasures(asMeasures);
        if (asMeasures.length === 0) setMeasuresError("Nenhum campo encontrado na pagina atual. Navegue ate uma pagina com visuais e tente novamente.");
      })
      .catch(() => setMeasuresError("Nao foi possivel ler os campos do relatorio. O relatorio precisa estar carregado."))
      .finally(() => setLoadingMeasures(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(input: AlertInput) {
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") {
        await alertsApi.createAlert(workspaceId, report.id, input);
      } else if (editing) {
        await alertsApi.updateAlert(workspaceId, editing.id, input);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(extractErrorMessage(err) || "Nao foi possivel salvar o alerta.");
    } finally {
      setSaving(false);
    }
  }

  async function attempt(action: () => Promise<unknown>, fallback: string) {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(extractErrorMessage(err) || fallback);
    }
  }

  if (editing) {
    return (
      <Modal title={editing === "new" ? "Novo alerta" : "Editar alerta"} onClose={onClose}>
        <AlertForm
          initial={editing === "new" ? null : editing}
          measures={measures}
          loadingMeasures={loadingMeasures}
          saving={saving}
          error={formError}
          onSubmit={handleSave}
          onCancel={() => {
            setEditing(null);
            setFormError(null);
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal title="Alertas" onClose={onClose} wide>
      <p style={{ marginTop: 0, color: "var(--color-text-muted)", fontSize: 14 }}>
        Monitoramento de medidas de <strong>{report.name}</strong>. Envia e-mail quando o valor
        atingir a condicao configurada.
      </p>
      {loadError && <p className="auth-error">{loadError}</p>}
      {measuresError && <p className="auth-error">{measuresError}</p>}
      {actionError && (
        <p className="auth-error" role="alert">
          {actionError}
        </p>
      )}
      {items === null && !loadError && <p>Carregando...</p>}
      {items?.length === 0 && <p>Nenhum alerta configurado neste relatorio.</p>}

      {items?.map((alert) => (
        <div key={alert.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{alert.name || `${alert.measure_name} ${alert.condition} ${alert.threshold}`}</strong>
            <span className="badge badge-name">{alert.enabled ? "Ativo" : "Pausado"}</span>
            {alert.last_status && (
              <span style={{ fontSize: 12, color: STATUS_COLOR[alert.last_status] ?? "inherit" }}>
                {STATUS_LABEL[alert.last_status] ?? alert.last_status}
              </span>
            )}
          </div>

          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
            {alert.table_name ? `${alert.table_name} / ` : ""}
            {alert.measure_name} {alert.condition} {alert.threshold}
            {" — "}
            {alert.recipients.length} destinatario(s)
          </p>

          {alert.last_value !== null && (
            <p style={{ margin: "2px 0 0", fontSize: 13 }}>
              Ultimo valor: <strong>{alert.last_value}</strong>
              {alert.last_checked_at ? ` em ${formatDateTime(alert.last_checked_at, "UTC")}` : ""}
            </p>
          )}

          {alert.last_triggered_at && (
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
              Ultimo disparo: {formatDateTime(alert.last_triggered_at, "UTC")}
            </p>
          )}

          {alert.last_status === "error" && alert.last_message && (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
              {alert.last_message}
            </p>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                attempt(
                  () => alertsApi.updateAlert(workspaceId, alert.id, { enabled: !alert.enabled }),
                  "Nao foi possivel alterar o alerta.",
                )
              }
            >
              {alert.enabled ? "Pausar" : "Reativar"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(alert)}>
              Editar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setToDelete(alert)}>
              Excluir
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          Novo alerta
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Fechar
        </button>
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Excluir alerta"
          message={`Excluir o alerta "${toDelete.name || `${toDelete.measure_name} ${toDelete.condition} ${toDelete.threshold}`}"?`}
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const target = toDelete;
            setToDelete(null);
            attempt(
              () => alertsApi.deleteAlert(workspaceId, target.id),
              "Nao foi possivel excluir o alerta.",
            );
          }}
        />
      )}
    </Modal>
  );
}
