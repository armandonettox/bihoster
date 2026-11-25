import { useEffect, useState } from "react";
import * as panelApi from "../../api/accessPanel";
import type { PanelKind, Preset, Subject } from "../../api/accessPanel";
import { extractErrorMessage } from "../../api/client";
import * as reportsApi from "../../api/reports";
import type { CatalogItem, HistoryEntry } from "../../api/workspaceCatalog";
import * as catalogApi from "../../api/workspaceCatalog";
import { useAccess } from "../../context/AccessContext";
import { useToast } from "../../context/ToastContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { formatDateTime } from "../../utils/datetime";
import Modal from "../Modal";
import MultiSelect from "../MultiSelect";
import { Avatar } from "./Avatar";

/** Pastas de um relatório (ou de vários de uma vez, sem mexer nas outras pastas deles). Em lote mostra o que vai mudar e
 * pede confirmação antes de gravar. */
export function FoldersModal({ reports, onClose, onDone }: { reports: CatalogItem[]; onClose: () => void; onDone: () => void }) {
  const { workspaces } = useWorkspace();
  const access = useAccess();
  const { showToast } = useToast();
  const single = reports.length === 1 ? reports[0] : null;
  const options = workspaces
    .filter((w) => access.canIn("relatorio.publicar", w.id))
    .map((w) => ({ value: String(w.id), label: w.name }));
  const [current, setCurrent] = useState<string[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!single || single.collection_id == null) return;
    let cancelled = false;
    reportsApi
      .getReportFolders(single.collection_id, single.id)
      .then((folders) => {
        if (cancelled) return;
        const ids = folders.collection_ids.map(String);
        setCurrent(ids);
        setInitial(ids);
      })
      .catch((err) => !cancelled && setError(extractErrorMessage(err) || "Não foi possível ler as pastas do relatório."));
    return () => {
      cancelled = true;
    };
  }, [single]);

  const nameOf = (id: string) => workspaces.find((w) => String(w.id) === id)?.name ?? id;
  const inRoot = reports.filter((r) => r.in_root).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (single && single.collection_id != null) {
        await reportsApi.setReportFolders(single.collection_id, single.id, current.map(Number));
      } else {
        await catalogApiBulk(reports.map((r) => r.id), adding.map(Number), removing.map(Number));
      }
      showToast("Pastas atualizadas.");
      onDone();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Não foi possível mudar as pastas.");
      setReview(false);
    } finally {
      setSaving(false);
    }
  }

  const changed = single ? current.length !== initial.length || current.some((id) => !initial.includes(id)) : adding.length + removing.length > 0;

  return (
    <Modal title={single ? `Pastas de ${single.name}` : `Pastas de ${reports.length} relatórios`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {options.length === 0 ? (
          <p className="rpt-muted">Você não pode publicar relatórios em nenhuma pasta.</p>
        ) : single ? (
          <>
            <p className="rpt-muted" style={{ margin: 0 }}>
              O mesmo relatório pode aparecer em várias pastas sem ser cadastrado de novo. Sem nenhuma pasta, ele fica só no catálogo (Raiz).
            </p>
            <MultiSelect label="Pastas" options={options} selected={current} onChange={setCurrent} emptyLabel="Nenhuma pasta (só no catálogo)" />
          </>
        ) : (
          <>
            <label className="field">
              Pôr nas pastas
              <MultiSelect label="Pôr nas pastas" options={options} selected={adding} onChange={setAdding} emptyLabel="Nenhuma" />
            </label>
            <label className="field">
              Tirar das pastas
              <MultiSelect label="Tirar das pastas" options={options} selected={removing} onChange={setRemoving} emptyLabel="Nenhuma" />
            </label>
            <p className="rpt-muted" style={{ margin: 0 }}>As outras pastas de cada relatório não mudam.</p>
          </>
        )}

        {review && (
          <div className="rpt-undo" role="note" style={{ background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e3a8a", display: "block" }}>
            <strong>O que vai mudar</strong>
            <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
              {adding.length > 0 && <li>{reports.length} relatórios entram em: {adding.map(nameOf).join(", ")}.</li>}
              {removing.length > 0 && <li>{reports.length} relatórios saem de: {removing.map(nameOf).join(", ")}.</li>}
              {adding.length > 0 && inRoot > 0 && <li>{inRoot} {inRoot === 1 ? "está" : "estão"} só no catálogo e {inRoot === 1 ? "será publicado" : "serão publicados"}.</li>}
              {removing.length > 0 && <li>Quem fica sem nenhuma pasta volta para o catálogo (nada é apagado).</li>}
            </ul>
          </div>
        )}
        {error && <p className="auth-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          {single || review ? (
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!changed || saving || options.length === 0} onClick={() => void save()}>
              {saving ? "Salvando..." : review ? "Confirmar" : "Salvar"}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!changed || options.length === 0} onClick={() => setReview(true)}>
              Revisar
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

async function catalogApiBulk(reportIds: number[], add: number[], remove: number[]) {
  await panelApi.bulkFolders({ report_ids: reportIds, add, remove });
}

/** Histórico de atualização de um modelo, como o Power BI o informa. */
export function HistoryModal({ datasetId, name, onClose }: { datasetId: number; name: string; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getDatasetHistory(datasetId)
      .then((list) => !cancelled && setRows(list))
      .catch((err) => !cancelled && setError(extractErrorMessage(err) || "Não foi possível ler o histórico."));
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return (
    <Modal title={`Histórico de atualização: ${name}`} onClose={onClose} wide>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!rows && !error && <div className="rpt-skel" />}
      {rows && rows.length === 0 && <p className="rpt-muted">O Power BI não informou nenhuma atualização deste modelo.</p>}
      {rows && rows.length > 0 && (
        <table className="rpt-table">
          <thead>
            <tr><th>Estado</th><th>Tipo</th><th>Início</th><th>Fim</th></tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{row.status ?? "—"}{row.error && <div className="auth-error" style={{ fontSize: 12 }}>{row.error}</div>}</td>
                <td>{row.kind ?? "—"}</td>
                <td>{row.started_at ? formatDateTime(row.started_at) : "—"}</td>
                <td>{row.ended_at ? formatDateTime(row.ended_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** Compartilhar vários itens de uma vez com uma pessoa ou grupo, com a confirmação do que muda. */
export function BulkShareModal({ items, onClose, onDone }: { items: CatalogItem[]; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Subject[]>([]);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetKey, setPresetKey] = useState("ver");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reports = items.filter((i) => i.kind === "report");
  const datasets = items.filter((i) => i.kind === "dataset");
  const kinds: PanelKind[] = [...(reports.length ? (["report"] as const) : []), ...(datasets.length ? (["dataset"] as const) : [])];

  useEffect(() => {
    let cancelled = false;
    Promise.all(kinds.map((kind) => panelApi.getKindCatalog(kind)))
      .then((catalogs) => {
        if (cancelled) return;
        // Presets que existem para todos os tipos escolhidos (so o "ver" vale para relatorio e modelo ao mesmo tempo)
        const common = catalogs[0].presets.filter((p) => catalogs.every((c) => c.presets.some((q) => q.key === p.key)));
        setPresets(common);
        setPresetKey(common[0]?.key ?? "ver");
      })
      .catch(() => !cancelled && setPresets([{ key: "ver", label: "Ver", permissions: [] }]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!text || subject) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      panelApi.searchSubjects(text).then((list) => !cancelled && setOptions(list)).catch(() => !cancelled && setOptions([]));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, subject]);

  const root = reports.filter((r) => r.in_root).length;
  const label = presets.find((p) => p.key === presetKey)?.label ?? presetKey;

  async function save() {
    if (!subject) return;
    setSaving(true);
    setError(null);
    try {
      const result = await panelApi.bulkShare({
        items: items.map((i) => ({ kind: i.kind, id: i.id })),
        user_ids: subject.kind === "user" ? [subject.id] : [],
        group_ids: subject.kind === "group" ? [subject.id] : [],
        preset: presetKey,
      });
      showToast(result.changes === 0 ? "Nada mudou: já estava assim." : `${result.changes} acessos alterados.`);
      onDone();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Não foi possível compartilhar.");
      setReview(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Compartilhar ${items.length} ${items.length === 1 ? "item" : "itens"}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {subject ? (
          <div className="rpt-entry" style={{ border: "none" }}>
            <Avatar name={subject.name} picture={subject.picture_url} group={subject.kind === "group"} />
            <div>
              <div className="rpt-entry-name">{subject.name}</div>
              <div className="rpt-entry-origin">{subject.kind === "group" ? "Grupo" : subject.email}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSubject(null); setReview(false); }}>Trocar</button>
          </div>
        ) : (
          <div className="rpt-suggest">
            <input className="input" role="combobox" aria-expanded={options.length > 0} aria-label="Pessoa ou grupo" placeholder="Pessoa ou grupo (nome ou e-mail)" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            {options.length > 0 && (
              <div className="rpt-suggest-list" role="listbox">
                {options.map((o) => (
                  <button key={`${o.kind}:${o.id}`} type="button" role="option" aria-selected={false} onClick={() => { setSubject(o); setQuery(""); }}>
                    <Avatar name={o.name} picture={o.picture_url} group={o.kind === "group"} />
                    <span>{o.name}<div className="rpt-entry-origin">{o.kind === "group" ? "Grupo" : o.email}</div></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="field">
          O que pode fazer
          <select className="input" value={presetKey} onChange={(e) => { setPresetKey(e.target.value); setReview(false); }}>
            {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {review && subject && (
          <div className="rpt-undo" role="note" style={{ background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e3a8a", display: "block" }}>
            <strong>O que vai mudar</strong>
            <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
              <li>{subject.name} passa a ter “{label}” em {reports.length ? `${reports.length} ${reports.length === 1 ? "relatório" : "relatórios"}` : ""}{reports.length && datasets.length ? " e " : ""}{datasets.length ? `${datasets.length} ${datasets.length === 1 ? "modelo" : "modelos"}` : ""}.</li>
              {root > 0 && <li>{root} {root === 1 ? "relatório do catálogo será publicado" : "relatórios do catálogo serão publicados"} para {subject.name}.</li>}
              <li>O que {subject.name} já tinha de mais não é tirado.</li>
            </ul>
          </div>
        )}
        {error && <p className="auth-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          {review ? (
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={() => void save()}>{saving ? "Compartilhando..." : "Confirmar"}</button>
          ) : (
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!subject} onClick={() => setReview(true)}>Revisar</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
