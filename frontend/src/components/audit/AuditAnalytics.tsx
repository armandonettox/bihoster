import { useEffect, useState } from "react";
import {
  getAuditSummary,
  getDashboard,
  resetDashboard,
  saveDashboard,
  type AuditFilters,
  type AuditSummary,
  type Dashboard,
  type DashboardWidget,
} from "../../api/audit";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import ConfirmDialog from "../ConfirmDialog";
import { SkeletonList } from "../Skeleton";
import DashboardGrid from "./dashboard/DashboardGrid";

type Result = { key: string; data?: AuditSummary; failed?: boolean };

interface Props {
  filters: AuditFilters;
  /** Quem pode editar o painel (mover, redimensionar e salvar para todos) */
  canEdit?: boolean;
}

// So posicao e tamanho entram na comparacao: e o que o modo de edicao muda
const positions = (widgets: DashboardWidget[]) => JSON.stringify(widgets.map((w) => [w.id, w.x, w.y, w.w, w.h]));

/** Aba Analiticos: o painel de visuais (compartilhado, editavel) com os mesmos filtros da tabela. */
export default function AuditAnalytics({ filters, canEdit = false }: Props) {
  const { showToast } = useToast();
  const [result, setResult] = useState<Result | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardFailed, setDashboardFailed] = useState(false);
  const [draft, setDraft] = useState<DashboardWidget[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "reset" | null>(null);
  const requestKey = JSON.stringify(filters);
  const editing = draft !== null;

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

  // O layout e o mesmo para todos e nao depende dos filtros: carrega uma vez
  useEffect(() => {
    let cancelled = false;
    getDashboard()
      .then((data) => !cancelled && setDashboard(data))
      .catch(() => !cancelled && setDashboardFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (dashboardFailed) {
    return <p className="audit-empty" role="alert">Nao foi possivel carregar o painel.</p>;
  }
  if (result?.key !== requestKey || !dashboard) return <SkeletonList count={4} />;
  if (result.failed || !result.data) {
    return <p className="audit-empty" role="alert">Nao foi possivel carregar os analiticos.</p>;
  }

  const summary = result.data;
  const dirty = draft !== null && positions(draft) !== positions(dashboard.widgets);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      setDashboard(await saveDashboard(draft));
      setDraft(null);
      showToast("Painel salvo para todos.");
    } catch (err: unknown) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar o painel.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setConfirm(null);
    setSaving(true);
    try {
      setDashboard(await resetDashboard());
      setDraft(null);
      showToast("Painel restaurado ao padrao.");
    } catch (err: unknown) {
      showToast(extractErrorMessage(err) || "Nao foi possivel restaurar o painel.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="dash-toolbar">
        {editing ? (
          <>
            <p className="dash-toolbar-hint">
              <span className="material-symbols-outlined" aria-hidden="true">edit</span>
              Modo de edicao: arraste pelo titulo e redimensione pelas bordas e cantos. O painel e o mesmo para
              todos, e so muda depois de Salvar.
            </p>
            <div className="dash-toolbar-actions">
              <button className="btn btn-primary" disabled={saving || !dirty} onClick={save}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button className="btn btn-ghost" disabled={saving} onClick={() => (dirty ? setConfirm("cancel") : setDraft(null))}>
                Cancelar
              </button>
              <button className="btn btn-ghost" disabled={saving || dashboard.is_default} onClick={() => setConfirm("reset")}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">restart_alt</span>
                Restaurar padrao
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dash-toolbar-hint">
              {dashboard.is_default || !dashboard.updated_by ? "" : `Layout salvo por ${dashboard.updated_by}.`}
            </p>
            {canEdit && (
              <div className="dash-toolbar-actions">
                <button className="btn btn-ghost" onClick={() => setDraft(dashboard.widgets)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">dashboard_customize</span>
                  Editar painel
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {summary.totals.events === 0 && <p className="audit-empty">Nenhum evento nesse periodo e com esses filtros.</p>}

      <DashboardGrid
        widgets={draft ?? dashboard.widgets}
        columns={dashboard.columns}
        summary={summary}
        editing={editing}
        onChange={setDraft}
      />

      {confirm === "cancel" && (
        <ConfirmDialog
          title="Descartar as mudancas?"
          message="O painel voltara ao ultimo layout salvo."
          confirmLabel="Descartar"
          onConfirm={() => {
            setConfirm(null);
            setDraft(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "reset" && (
        <ConfirmDialog
          title="Restaurar o painel padrao?"
          message="O layout salvo sera apagado para todos e o painel volta ao padrao."
          confirmLabel="Restaurar"
          onConfirm={reset}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
