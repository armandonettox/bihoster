import { useEffect, useState } from "react";
import {
  getAuditSummary,
  getDashboard,
  resetDashboard,
  saveDashboard,
  type AuditFilters,
  type AuditOptions,
  type AuditSummary,
  type Dashboard,
  type DashboardWidget,
} from "../../api/audit";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import ConfirmDialog from "../ConfirmDialog";
import { SkeletonList } from "../Skeleton";
import DashboardGrid from "./dashboard/DashboardGrid";
import type { FilterPatch } from "./dashboard/interactions";
import { DEFAULT_SIZE } from "./dashboard/widgetCatalog";
import WidgetEditor from "./dashboard/WidgetEditor";

type Result = { key: string; data?: AuditSummary; failed?: boolean };

interface Props {
  filters: AuditFilters;
  /** Listas dos filtros (pessoas, acoes, colecoes...), usadas nos filtros proprios de cada visual */
  options?: AuditOptions | null;
  /** O que a pessoa pode fazer no painel: criar, editar (inclui mover e redimensionar) e excluir visuais */
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Clicar num item de um visual (barra, fatia, dia, cartao) aplica este filtro na pagina */
  onFilterBy?: (patch: FilterPatch) => void;
}

/** Tudo que o modo de edicao muda (posicao, tamanho, visuais novos ou removidos, titulo, cor, consulta) */
const snapshot = (widgets: DashboardWidget[]) => JSON.stringify(widgets);

/** Primeira linha livre abaixo de todos os visuais, para o visual novo entrar no fim do painel */
const bottomOf = (widgets: DashboardWidget[]) => widgets.reduce((bottom, w) => Math.max(bottom, w.y + w.h), 0);

/** Aba Analiticos: o painel de visuais (compartilhado, editavel) com os mesmos filtros da tabela. */
export default function AuditAnalytics({ filters, options = null, canCreate = false, canEdit = false, canDelete = false, onFilterBy }: Props) {
  const canChange = canCreate || canEdit || canDelete;
  const { showToast } = useToast();
  const [result, setResult] = useState<Result | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardFailed, setDashboardFailed] = useState(false);
  const [draft, setDraft] = useState<DashboardWidget[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "reset" | null>(null);
  // Janela de visual aberta: sem widget e um visual novo; com widget, configura o existente
  const [editor, setEditor] = useState<{ widget?: DashboardWidget } | null>(null);
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
  const dirty = draft !== null && snapshot(draft) !== snapshot(dashboard.widgets);

  function applyEditor(widget: DashboardWidget) {
    const current = draft ?? [];
    if (editor?.widget) {
      setDraft(current.map((w) => (w.id === widget.id ? widget : w)));
    } else {
      // Visual novo entra no fim do painel, na primeira coluna
      setDraft([...current, { ...widget, x: 0, y: bottomOf(current), ...DEFAULT_SIZE[widget.type] }]);
    }
    setEditor(null);
  }

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
              {canCreate && <button className="btn btn-ghost" disabled={saving} onClick={() => setEditor({})}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">add_chart</span>
                Adicionar visual
              </button>}
              <button className="btn btn-primary" disabled={saving || !dirty} onClick={save}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button className="btn btn-ghost" disabled={saving} onClick={() => (dirty ? setConfirm("cancel") : setDraft(null))}>
                Cancelar
              </button>
              {canCreate && canEdit && canDelete && <button className="btn btn-ghost" disabled={saving || dashboard.is_default} onClick={() => setConfirm("reset")}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">restart_alt</span>
                Restaurar padrao
              </button>}
            </div>
          </>
        ) : (
          <>
            <p className="dash-toolbar-hint">
              {dashboard.is_default || !dashboard.updated_by ? "" : `Layout salvo por ${dashboard.updated_by}.`}
            </p>
            {canChange && (
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

      {(draft ?? dashboard.widgets).length === 0 && (
        <p className="audit-empty">
          O painel esta vazio. {editing ? "Use Adicionar visual para montar o primeiro." : "Quem edita o painel pode adicionar visuais."}
        </p>
      )}

      <DashboardGrid
        widgets={draft ?? dashboard.widgets}
        columns={dashboard.columns}
        summary={summary}
        filters={filters}
        editing={editing}
        canMove={canEdit}
        canConfigure={canEdit}
        canRemove={canDelete}
        onChange={setDraft}
        onFilterBy={onFilterBy}
        onEditWidget={(id) => setEditor({ widget: (draft ?? []).find((w) => w.id === id) })}
        onRemoveWidget={(id) => setDraft((draft ?? []).filter((w) => w.id !== id))}
      />

      {editor && (
        <WidgetEditor
          initial={editor.widget}
          filters={filters}
          options={options}
          summary={summary}
          onSave={applyEditor}
          onClose={() => setEditor(null)}
        />
      )}

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
