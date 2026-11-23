import { useCallback, useEffect, useState } from "react";
import * as alertsApi from "../../api/alerts";
import type { Alert, AlertInput, Measure, ReportChoice } from "../../api/alerts";
import { extractErrorMessage } from "../../api/client";
import AlertForm from "../../components/AlertForm";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import { useBranding } from "../../context/BrandingContext";
import { formatDateTime } from "../../utils/datetime";
import { formatPersonName } from "../../utils/personName";

const STATUS_LABELS: Record<string, string> = { ok: "Disparado", error: "Erro", skipped: "Aguardando" };

function alertTitle(a: Alert) {
  return a.name || `${a.measure_name} ${a.condition} ${a.threshold}`;
}

/** Modulo Alertas: todos os alertas do sistema, com criar, editar, pausar e excluir. A visao e do portal todo, mas
 * cada acao segue as permissoes da colecao (o servidor confere de novo). */
export default function AlertsTab() {
  const { settings } = useBranding();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [choices, setChoices] = useState<ReportChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Alert | "new" | null>(null);
  const [chosenReport, setChosenReport] = useState<number | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [loadingMeasures, setLoadingMeasures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Alert | null>(null);

  const load = useCallback(async () => {
    try {
      const [all, reports] = await Promise.all([
        alertsApi.listAllAlerts(),
        alertsApi.listReportsForNewAlert().catch(() => [] as ReportChoice[]),
      ]);
      setAlerts(all);
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
  }, [load]);

  // O relatorio do formulario: o do alerta editado, ou o escolhido na lista (novo)
  const target =
    editing === null
      ? null
      : editing === "new"
        ? (choices.find((c) => c.report_id === chosenReport) ?? null)
        : { report_id: editing.report_id, collection_id: editing.collection_id };

  const targetReportId = target?.report_id ?? null;
  const targetCollectionId = target?.collection_id ?? null;
  useEffect(() => {
    if (targetReportId === null || targetCollectionId === null) return;
    let cancelled = false;
    setLoadingMeasures(true);
    alertsApi
      .listReportMeasures(targetCollectionId, targetReportId)
      .then((data) => !cancelled && setMeasures(data))
      .catch(() => !cancelled && setMeasures([]))
      .finally(() => !cancelled && setLoadingMeasures(false));
    return () => {
      cancelled = true;
    };
  }, [targetReportId, targetCollectionId]);

  function closeForm() {
    setEditing(null);
    setChosenReport(null);
    setMeasures([]);
    setFormError(null);
  }

  async function handleSave(input: AlertInput) {
    if (!target || !editing) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") await alertsApi.createAlert(target.collection_id, target.report_id, input);
      else await alertsApi.updateAlert(editing.collection_id, editing.id, input);
      closeForm();
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

  const filtered = alerts.filter((a) => {
    if (!filter) return true;
    const haystack = `${a.collection_name ?? ""} ${a.report_name} ${a.name ?? ""} ${a.measure_name} ${a.created_by_name ?? ""}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });
  const active = alerts.filter((a) => a.enabled).length;
  const failing = alerts.filter((a) => a.last_status === "error").length;

  if (loadError) return <p className="auth-error">Nao foi possivel carregar os alertas.</p>;

  if (editing === "new" && chosenReport === null) {
    return (
      <Modal title="Novo alerta" onClose={closeForm}>
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
    return (
      <Modal title={editing === "new" ? "Novo alerta" : "Editar alerta"} onClose={closeForm}>
        {editing !== "new" && (
          <p style={{ marginTop: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
            {editing.collection_name} / {editing.report_name}
          </p>
        )}
        <AlertForm
          key={editing === "new" ? `novo-${chosenReport}-${loadingMeasures}` : `${editing.id}-${loadingMeasures}`}
          initial={editing === "new" ? null : editing}
          measures={measures}
          loadingMeasures={loadingMeasures}
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
      <h2 className="settings-section-title">Alertas por e-mail</h2>
      <p className="settings-section-desc">
        Todos os alertas do sistema: um e-mail e enviado quando a medida de um relatorio atinge a condicao configurada.
      </p>

      {!loading && alerts.length > 0 && (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 12px" }}>
          {alerts.length} alerta(s), {active} ativo(s)
          {failing > 0 ? `, ${failing} com erro na ultima verificacao` : ""}.
        </p>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Filtrar por colecao, relatorio, medida..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        {choices.length > 0 && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Novo alerta
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
          {alerts.length === 0 ? "Nenhum alerta cadastrado ainda." : "Nenhum alerta encontrado."}
        </p>
      ) : (
        <div className="card" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Colecao</th>
                <th>Relatorio</th>
                <th>Alerta</th>
                <th>Condicao</th>
                <th>Ultimo valor</th>
                <th>Ultima verificacao</th>
                <th>Situacao</th>
                <th>Criado por</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>{a.collection_name ?? "--"}</td>
                  <td>{a.report_name}</td>
                  <td>{alertTitle(a)}</td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {a.measure_name} {a.condition} {a.threshold}
                  </td>
                  <td>{a.last_value ?? "--"}</td>
                  <td style={{ fontSize: 13, whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
                    {a.last_checked_at ? formatDateTime(a.last_checked_at, settings?.timezone) : "--"}
                    {a.last_status && (
                      <span className={`badge${a.last_status === "error" ? " badge-error" : ""}`} style={{ marginLeft: 6 }}>
                        {STATUS_LABELS[a.last_status] ?? a.last_status}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge${a.enabled ? "" : " badge-muted"}`}>{a.enabled ? "Ativo" : "Pausado"}</span>
                  </td>
                  <td style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                    {a.created_by_name ? formatPersonName(a.created_by_name) : "--"}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {a.can_edit !== false && (
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`${a.enabled ? "Pausar" : "Reativar"} ${alertTitle(a)}`}
                        onClick={() =>
                          attempt(
                            () => alertsApi.updateAlert(a.collection_id, a.id, { enabled: !a.enabled }),
                            "Nao foi possivel alterar o alerta.",
                          )
                        }
                      >
                        {a.enabled ? "Pausar" : "Reativar"}
                      </button>
                    )}
                    {a.can_edit !== false && (
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Editar ${alertTitle(a)}`}
                        onClick={() => setEditing(a)}
                      >
                        Editar
                      </button>
                    )}
                    {a.can_delete !== false && (
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Excluir ${alertTitle(a)}`}
                        onClick={() => setToDelete(a)}
                      >
                        Excluir
                      </button>
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
          title="Excluir alerta"
          message={`Excluir o alerta "${alertTitle(toDelete)}"?`}
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const t = toDelete;
            setToDelete(null);
            attempt(() => alertsApi.deleteAlert(t.collection_id, t.id), "Nao foi possivel excluir o alerta.");
          }}
        />
      )}
    </div>
  );
}
