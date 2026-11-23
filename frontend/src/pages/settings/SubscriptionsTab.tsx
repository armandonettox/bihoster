import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../../api/client";
import * as emailApi from "../../api/emailSettings";
import * as powerbiApi from "../../api/powerbi";
import type { PowerBIPage } from "../../api/powerbi";
import * as reportsApi from "../../api/reports";
import * as subscriptionsApi from "../../api/subscriptions";
import type { Subscription, SubscriptionInput } from "../../api/subscriptions";
import type { ReportChoice } from "../../api/alerts";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import SubscriptionForm from "../../components/SubscriptionForm";
import RunProgress from "../../components/SubscriptionRunProgress";
import { useBranding } from "../../context/BrandingContext";
import { formatDateTime } from "../../utils/datetime";
import { formatPersonName } from "../../utils/personName";

const STATUS_LABELS: Record<string, string> = {
  ok: "Enviado",
  error: "Erro",
  skipped: "Pulado",
};

function subTitle(s: Subscription) {
  return s.name || s.schedule_text;
}

/** Modulo Assinaturas: todas as assinaturas do sistema, com criar, editar, pausar, enviar agora e excluir. A visao e
 * do portal todo, mas cada acao segue as permissoes da colecao (o servidor confere de novo). */
export default function SubscriptionsTab() {
  const { settings } = useBranding();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [choices, setChoices] = useState<ReportChoice[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [chosenReport, setChosenReport] = useState<number | null>(null);
  const [availablePages, setAvailablePages] = useState<PowerBIPage[]>([]);
  const [reportName, setReportName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Subscription | null>(null);
  const [running, setRunning] = useState<{ id: number; collectionId: number; jobId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, reports] = await Promise.all([
        subscriptionsApi.listAllSubscriptions(),
        subscriptionsApi.listReportsForNewSubscription().catch(() => [] as ReportChoice[]),
      ]);
      setSubs(all);
      setChoices(reports);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    emailApi
      .getEmailStatus()
      .then((status) => setAllowedDomains(status.allowed_domains ?? []))
      .catch(() => {});
  }, [load]);

  // O relatorio do formulario: o da assinatura editada, ou o escolhido na lista (nova)
  const target =
    editing === null
      ? null
      : editing === "new"
        ? (choices.find((c) => c.report_id === chosenReport) ?? null)
        : { report_id: editing.report_id, collection_id: editing.collection_id, report_name: editing.report_name };

  const targetReportId = target?.report_id ?? null;
  const targetCollectionId = target?.collection_id ?? null;
  useEffect(() => {
    if (targetReportId === null || targetCollectionId === null) return;
    let cancelled = false;
    setAvailablePages([]);
    reportsApi
      .getReport(targetCollectionId, targetReportId)
      .then((report) => {
        if (cancelled) return;
        setReportName(report.name);
        if (!report.powerbi_connection_id) return;
        return powerbiApi
          .listPowerBIPages(report.powerbi_connection_id, report.pbi_workspace_id, report.pbi_report_id)
          .then((pages) => !cancelled && setAvailablePages(pages));
      })
      .catch(() => !cancelled && setAvailablePages([]));
    return () => {
      cancelled = true;
    };
  }, [targetReportId, targetCollectionId]);

  function closeForm() {
    setEditing(null);
    setChosenReport(null);
    setAvailablePages([]);
    setFormError(null);
  }

  async function handleSave(input: SubscriptionInput) {
    if (!target || !editing) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") await subscriptionsApi.createSubscription(target.collection_id, target.report_id, input);
      else await subscriptionsApi.updateSubscription(editing.collection_id, editing.id, input);
      closeForm();
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
      const jobId = await subscriptionsApi.runSubscriptionNow(sub.collection_id, sub.id);
      setRunning({ id: sub.id, collectionId: sub.collection_id, jobId });
    } catch (err) {
      setActionError(extractErrorMessage(err) || "Nao foi possivel iniciar o envio.");
    }
  }

  const filtered = subs.filter((s) => {
    if (!filter) return true;
    const haystack = `${s.collection_name ?? ""} ${s.report_name} ${s.name ?? ""} ${s.created_by_name ?? ""} ${s.schedule_text}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });
  const active = subs.filter((s) => s.enabled).length;
  const failing = subs.filter((s) => s.last_status === "error").length;

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as assinaturas.</p>;

  if (editing === "new" && chosenReport === null) {
    return (
      <Modal title="Nova assinatura" onClose={closeForm}>
        <label className="field">
          Em qual relatorio?
          <select
            className="input"
            defaultValue=""
            onChange={(e) => setChosenReport(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Escolha um relatorio...</option>
            {choices.map((c) => (
              <option key={c.report_id} value={c.report_id}>
                {c.collection_name} / {c.report_name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={closeForm}>
            Cancelar
          </button>
        </div>
      </Modal>
    );
  }

  if (editing) {
    const shownReportName = target?.report_name ?? reportName;
    return (
      <Modal title={editing === "new" ? "Nova assinatura" : "Editar assinatura"} onClose={closeForm}>
        {editing !== "new" && (
          <p style={{ marginTop: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            {editing.collection_name} / {editing.report_name}
          </p>
        )}
        <SubscriptionForm
          key={editing === "new" ? `nova-${chosenReport}-${availablePages.length}` : `${editing.id}-${availablePages.length}`}
          initial={editing === "new" ? null : editing}
          allowedDomains={allowedDomains}
          availablePages={availablePages}
          reportName={shownReportName}
          saving={saving}
          error={formError}
          onSubmit={handleSave}
          onCancel={closeForm}
        />
      </Modal>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Assinaturas de e-mail</h2>
      <p className="settings-section-desc">
        Todas as assinaturas do sistema: envio recorrente de relatorio por e-mail, em dias e horarios escolhidos.
      </p>

      {!loading && subs.length > 0 && (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 12px" }}>
          {subs.length} assinatura(s), {active} ativa(s)
          {failing > 0 ? `, ${failing} com erro no ultimo envio` : ""}.
        </p>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Filtrar por colecao, relatorio, agenda..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        {choices.length > 0 && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Nova assinatura
          </button>
        )}
      </div>

      {actionError && (
        <p className="auth-error" role="alert">
          {actionError}
        </p>
      )}

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
                <th>Acoes</th>
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
                    <span className={`badge${s.enabled ? "" : " badge-muted"}`}>{s.enabled ? "Ativa" : "Pausada"}</span>
                  </td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {s.created_by_name ? formatPersonName(s.created_by_name) : "--"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {running?.id === s.id ? (
                      <RunProgress
                        workspaceId={running.collectionId}
                        jobId={running.jobId}
                        onFinished={() => {
                          setRunning(null);
                          load();
                        }}
                      />
                    ) : (
                      <>
                        {s.can_run !== false && (
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label={`Enviar agora ${subTitle(s)}`}
                            onClick={() => handleRunNow(s)}
                          >
                            Enviar agora
                          </button>
                        )}
                        {s.can_edit !== false && (
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label={`${s.enabled ? "Pausar" : "Reativar"} ${subTitle(s)}`}
                            onClick={() =>
                              attempt(
                                () => subscriptionsApi.updateSubscription(s.collection_id, s.id, { enabled: !s.enabled }),
                                "Nao foi possivel alterar a assinatura.",
                              )
                            }
                          >
                            {s.enabled ? "Pausar" : "Reativar"}
                          </button>
                        )}
                        {s.can_edit !== false && (
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label={`Editar ${subTitle(s)}`}
                            onClick={() => setEditing(s)}
                          >
                            Editar
                          </button>
                        )}
                        {s.can_delete !== false && (
                          <button
                            className="btn btn-ghost btn-sm"
                            aria-label={`Excluir ${subTitle(s)}`}
                            onClick={() => setToDelete(s)}
                          >
                            Excluir
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir assinatura"
          message={`Excluir a assinatura "${subTitle(toDelete)}"? O historico de envios tambem sera apagado.`}
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const t = toDelete;
            setToDelete(null);
            attempt(
              () => subscriptionsApi.deleteSubscription(t.collection_id, t.id),
              "Nao foi possivel excluir a assinatura.",
            );
          }}
        />
      )}
    </div>
  );
}
