import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../api/client";
import * as deliveryApi from "../api/reportDelivery";
import * as powerbiApi from "../api/powerbi";
import type { PowerBIPage } from "../api/powerbi";
import type { Report } from "../api/reports";
import * as api from "../api/subscriptions";
import type { Subscription, SubscriptionInput, SubscriptionRun } from "../api/subscriptions";
import { formatDateTime } from "../utils/datetime";
import ConfirmDialog from "./ConfirmDialog";
import Modal from "./Modal";
import SubscriptionForm from "./SubscriptionForm";

const POLL_MS = 2000;
const GIVE_UP_MS = 6 * 60 * 1000;
const RUN_LABEL: Record<string, string> = { ok: "Enviado", error: "Falhou", skipped: "Pulado" };

/** Acompanha um envio manual ate terminar, mostrando a mensagem do servidor. */
function RunProgress({ workspaceId, jobId, onFinished }: { workspaceId: number; jobId: string; onFinished: () => void }) {
  const [message, setMessage] = useState("Iniciando o envio...");
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    async function poll() {
      try {
        const current = await deliveryApi.getDeliveryStatus(workspaceId, jobId);
        if (cancelled) return;
        setMessage(current.message || "Enviando...");
        if (current.status === "done" || current.status === "error") return onFinished();
      } catch {
        // Falha pontual de rede: tenta de novo no proximo ciclo
      }
      if (cancelled) return;
      if (Date.now() - startedAt > GIVE_UP_MS) return onFinished();
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, jobId]);
  return (
    <p role="status" style={{ margin: "6px 0 0", fontSize: 13 }}>
      {message}
    </p>
  );
}

function History({ workspaceId, subscriptionId, timezone }: { workspaceId: number; subscriptionId: number; timezone: string }) {
  const [runs, setRuns] = useState<SubscriptionRun[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .listSubscriptionRuns(workspaceId, subscriptionId)
      .then((data) => !cancelled && setRuns(data))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, subscriptionId]);
  if (runs === null) return <p style={{ fontSize: 13 }}>Carregando historico...</p>;
  if (runs.length === 0) return <p style={{ fontSize: 13 }}>Nenhum envio ainda.</p>;
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
      {runs.map((run) => (
        <li key={run.id}>
          {formatDateTime(run.started_at, timezone)} - {RUN_LABEL[run.status] ?? run.status}
          {run.trigger === "manual" ? " (manual)" : ""}
          {run.message ? `: ${run.message}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** Assinaturas de um relatorio: envio recorrente por e-mail em dias e horarios escolhidos. */
export default function ReportSubscriptionsModal({
  report,
  workspaceId,
  allowedDomains,
  onClose,
}: {
  report: Report;
  workspaceId: number;
  allowedDomains: string[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<Subscription[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [availablePages, setAvailablePages] = useState<PowerBIPage[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Subscription | null>(null);
  const [historyOf, setHistoryOf] = useState<number | null>(null);
  const [running, setRunning] = useState<{ id: number; jobId: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.listReportSubscriptions(workspaceId, report.id));
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err) || "Nao foi possivel carregar as assinaturas.");
    }
  }, [workspaceId, report.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!report.powerbi_connection_id) return;
    powerbiApi
      .listPowerBIPages(report.powerbi_connection_id, report.pbi_workspace_id, report.pbi_report_id)
      .then(setAvailablePages)
      .catch(() => setAvailablePages([]));
  }, [report.powerbi_connection_id, report.pbi_workspace_id, report.pbi_report_id]);

  async function handleSave(input: SubscriptionInput) {
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") await api.createSubscription(workspaceId, report.id, input);
      else if (editing) await api.updateSubscription(workspaceId, editing.id, input);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(extractErrorMessage(err) || "Nao foi possivel salvar a assinatura.");
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

  async function handleRunNow(sub: Subscription) {
    setActionError(null);
    try {
      setRunning({ id: sub.id, jobId: await api.runSubscriptionNow(workspaceId, sub.id) });
    } catch (err) {
      setActionError(extractErrorMessage(err) || "Nao foi possivel iniciar o envio.");
    }
  }

  if (editing) {
    return (
      <Modal title={editing === "new" ? "Nova assinatura" : "Editar assinatura"} onClose={onClose}>
        <SubscriptionForm
          initial={editing === "new" ? null : editing}
          allowedDomains={allowedDomains}
          availablePages={availablePages}
          reportName={report.name}
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
    <Modal title="Assinaturas" onClose={onClose} wide>
      <p style={{ marginTop: 0, color: "var(--color-text-muted)", fontSize: 14 }}>
        Envio recorrente de <strong>{report.name}</strong> por e-mail, em dias e horarios escolhidos.
      </p>
      {loadError && <p className="auth-error">{loadError}</p>}
      {actionError && (
        <p className="auth-error" role="alert">
          {actionError}
        </p>
      )}
      {items === null && !loadError && <p>Carregando...</p>}
      {items?.length === 0 && <p>Nenhuma assinatura neste relatorio ainda.</p>}

      {items?.map((sub) => (
        <div key={sub.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{sub.name || sub.schedule_text}</strong>
            <span className="badge badge-name">{sub.enabled ? "Ativa" : "Pausada"}</span>
            <span className="badge badge-name">{sub.format === "PDF" ? "PDF" : "Imagem"}</span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
            {sub.name ? `${sub.schedule_text} - ` : ""}
            {sub.recipients.length} destinatario(s)
            {sub.enabled && sub.next_run_at ? ` - proximo envio: ${formatDateTime(sub.next_run_at, sub.timezone)}` : ""}
          </p>
          {sub.last_status === "error" && (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
              Ultimo envio falhou{sub.last_message ? `: ${sub.last_message}` : ""}
            </p>
          )}
          {running?.id === sub.id ? (
            <RunProgress
              workspaceId={workspaceId}
              jobId={running.jobId}
              onFinished={() => {
                setRunning(null);
                load();
              }}
            />
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => handleRunNow(sub)}>
                Enviar agora
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  attempt(
                    () => api.updateSubscription(workspaceId, sub.id, { enabled: !sub.enabled }),
                    "Nao foi possivel alterar a assinatura.",
                  )
                }
              >
                {sub.enabled ? "Pausar" : "Reativar"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(sub)}>
                Editar
              </button>
              <button
                className="btn btn-ghost btn-sm"
                aria-expanded={historyOf === sub.id}
                onClick={() => setHistoryOf(historyOf === sub.id ? null : sub.id)}
              >
                Historico
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setToDelete(sub)}>
                Excluir
              </button>
            </div>
          )}
          {historyOf === sub.id && <History workspaceId={workspaceId} subscriptionId={sub.id} timezone={sub.timezone} />}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          Nova assinatura
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Fechar
        </button>
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Excluir assinatura"
          message={`Excluir a assinatura "${toDelete.name || toDelete.schedule_text}"? O historico de envios tambem sera apagado.`}
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const target = toDelete;
            setToDelete(null);
            attempt(() => api.deleteSubscription(workspaceId, target.id), "Nao foi possivel excluir a assinatura.");
          }}
        />
      )}
    </Modal>
  );
}
