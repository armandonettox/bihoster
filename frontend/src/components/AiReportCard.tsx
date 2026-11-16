import { useEffect, useRef, useState } from "react";
import * as aiReportApi from "../api/aiReport";
import type { AIReportSchema, AIReportSettings, BlockedColumn, ReviewState } from "../api/aiReport";
import { extractErrorMessage } from "../api/client";
import { listReports } from "../api/reports";
import { useToast } from "../context/ToastContext";
import { useWorkspace } from "../context/WorkspaceContext";

const MAX_NOTES = 2000;

interface ReportOption {
  id: number;
  name: string;
  collection: string;
}

const sameColumn = (a: BlockedColumn, b: BlockedColumn) =>
  a.table.toLowerCase() === b.table.toLowerCase() && a.column.toLowerCase() === b.column.toLowerCase();

const columnKey = (c: BlockedColumn) => `${c.table.toLowerCase()}\u0000${c.column.toLowerCase()}`;

/** O que aparece ao lado do nome do relatorio na lista */
const REVIEW_SUFFIX: Record<ReviewState, string> = {
  reviewed: "",
  unreviewed: " - nao revisado",
  pending: " - fechado ate revisar",
};

/** Aviso no formulario, por estado de revisao */
const REVIEW_NOTICE: Record<ReviewState, string> = {
  reviewed: "Colunas revisadas: o chat consulta este relatorio.",
  unreviewed:
    "As colunas deste relatorio ainda nao foram revisadas. O chat ja o consulta, entao confira se alguma coluna tem nomes de pessoas ou documentos.",
  pending:
    "Relatorio novo: o chat ainda nao o consulta. Revise as colunas abaixo, bloqueie as que tem dados de pessoas e marque como revisado para liberar.",
};

/** Por relatorio: o que a IA enxerga (tabelas e colunas, com a quantidade de valores diferentes), orientacoes
 * escritas pelo admin, colunas que ela nunca consulta e se ela pode receber a imagem da pagina aberta.
 * So nomes e contagens: nenhuma linha de dado aparece aqui. */
export default function AiReportCard() {
  const { showToast } = useToast();
  const { workspaces } = useWorkspace();

  const [reports, setReports] = useState<ReportOption[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [schema, setSchema] = useState<AIReportSchema | null>(null);
  const [saved, setSaved] = useState<AIReportSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Estado de revisao de cada relatorio da lista (id do relatorio -> estado)
  const [reviews, setReviews] = useState<Record<number, ReviewState>>({});
  const [reviewing, setReviewing] = useState(false);

  const [notes, setNotes] = useState("");
  const [blocked, setBlocked] = useState<BlockedColumn[]>([]);
  const [allowImages, setAllowImages] = useState(false);
  const [saving, setSaving] = useState(false);
  // Cada escolha de relatorio tem um numero: resposta de uma escolha antiga nao sobrescreve a atual
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    aiReportApi
      .getReviewStates()
      .then((list) => {
        if (!cancelled) setReviews(Object.fromEntries(list.map((item) => [item.report_id, item.review])));
      })
      .catch(() => undefined); // sem o estado a lista so perde a marca, nada mais
    Promise.all(
      workspaces.map((workspace) =>
        listReports(workspace.id)
          .then((list) => list.map((r) => ({ id: r.id, name: r.name, collection: workspace.name })))
          .catch(() => [] as ReportOption[]),
      ),
    ).then((groups) => {
      if (!cancelled) setReports(groups.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  function fillForm(settings: AIReportSettings) {
    setSaved(settings);
    setNotes(settings.notes);
    setBlocked(settings.blocked_columns);
    setAllowImages(settings.allow_images);
    setReviews((current) => ({ ...current, [settings.report_id]: settings.review }));
  }

  async function load(reportId: number, refresh = false) {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [loadedSchema, settings] = await Promise.all([
        aiReportApi.getReportSchema(reportId, refresh),
        aiReportApi.getReportSettings(reportId),
      ]);
      if (request !== requestRef.current) return;
      setSchema(loadedSchema);
      fillForm(settings);
    } catch (err: any) {
      if (request !== requestRef.current) return;
      setSchema(null);
      setSaved(null);
      setError(extractErrorMessage(err) || "Nao foi possivel carregar este relatorio.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  function handleSelect(value: string) {
    if (value === "") {
      requestRef.current++;
      setSelectedId("");
      setSchema(null);
      setSaved(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = Number(value);
    setSelectedId(id);
    void load(id);
  }

  function toggleBlocked(table: string, column: string, on: boolean) {
    const target = { table, column };
    setBlocked((current) => (on ? [...current.filter((c) => !sameColumn(c, target)), target] : current.filter((c) => !sameColumn(c, target))));
  }

  const blockedKeys = new Set(blocked.map(columnKey));
  const dirty =
    saved !== null &&
    (notes.trim() !== saved.notes.trim() ||
      allowImages !== saved.allow_images ||
      blocked.length !== saved.blocked_columns.length ||
      saved.blocked_columns.some((c) => !blockedKeys.has(columnKey(c))));

  async function handleSave() {
    if (selectedId === "" || saving) return;
    setSaving(true);
    try {
      const settings = await aiReportApi.saveReportSettings(selectedId, {
        notes: notes.trim(),
        blocked_columns: blocked,
        allow_images: allowImages,
      });
      fillForm(settings);
      // O esquema que a IA recebe mudou com os bloqueios: atualiza a contagem sem ir ao Power BI de novo
      const refreshed = await aiReportApi.getReportSchema(selectedId);
      setSchema(refreshed);
      showToast("Configuracao do relatorio salva.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReview() {
    if (selectedId === "" || reviewing) return;
    setReviewing(true);
    try {
      const settings = await aiReportApi.markReportReviewed(selectedId);
      fillForm(settings);
      showToast("Colunas revisadas. O chat ja pode consultar este relatorio.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel marcar como revisado.", "error");
    } finally {
      setReviewing(false);
    }
  }

  const unreviewedCount = reports ? reports.filter((r) => (reviews[r.id] ?? "reviewed") !== "reviewed").length : 0;
  const tables = schema?.tables ?? [];
  const inPrompt = tables.filter((t) => t.in_prompt).length;

  return (
    <section className="settings-section" aria-label="Relatorios e o chat">
      <h2 className="settings-section-title">Relatorios e o chat</h2>
      <p className="settings-section-desc">
        Veja o que a IA enxerga de cada relatorio, escreva orientacoes sobre o que os dados significam e bloqueie as
        colunas que ela nunca deve consultar (nomes de pessoas, documentos). Aqui aparecem so nomes e contagens, nunca
        linhas de dados.
      </p>

      {reports !== null && unreviewedCount > 0 && (
        <p className="chat-hint" role="status">
          {unreviewedCount} de {reports.length} relatorios ainda sem revisao das colunas.
        </p>
      )}

      {reports === null ? (
        <p className="settings-section-desc">Carregando relatorios...</p>
      ) : (
        <label className="field" style={{ maxWidth: 460 }}>
          Relatorio
          <select className="input" value={selectedId} onChange={(e) => handleSelect(e.target.value)}>
            <option value="">Escolha um relatorio</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.collection}){REVIEW_SUFFIX[reviews[r.id] ?? "reviewed"]}
              </option>
            ))}
          </select>
        </label>
      )}

      {loading && <p className="settings-section-desc">Lendo o relatorio no Power BI...</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {schema && !schema.eligible && (
        <p className="settings-section-desc">O chat nao consulta este relatorio. {schema.reason}</p>
      )}

      {schema?.eligible && saved && (
        <div style={{ marginTop: 16 }}>
          <p className={saved.review === "pending" ? "auth-error" : "chat-hint"} role="status">
            {REVIEW_NOTICE[saved.review]}
          </p>
          {saved.review !== "reviewed" && (
            <p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={dirty || reviewing || saving}
                onClick={() => void handleReview()}
              >
                {reviewing ? "Marcando..." : "Marcar como revisado"}
              </button>
              {dirty && <span className="chat-hint"> Salve as mudancas antes de marcar como revisado.</span>}
            </p>
          )}
          <p className="ai-report-summary">
            A IA recebe {inPrompt} de {tables.length} tabelas ({schema.prompt_chars.toLocaleString("pt-BR")} de{" "}
            {schema.prompt_max_chars.toLocaleString("pt-BR")} caracteres).{" "}
            <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load(schema.report_id, true)}>
              Atualizar do Power BI
            </button>
          </p>
          {schema.omitted_tables.length > 0 && (
            <p className="auth-error" role="status">
              Ficaram de fora por tamanho e a IA nao consegue usar: {schema.omitted_tables.join(", ")}.
            </p>
          )}
          {schema.omitted_columns > 0 && (
            <p className="chat-hint">{schema.omitted_columns} colunas foram cortadas pelo limite por tabela.</p>
          )}
          {schema.hidden_columns > 0 && (
            <p className="chat-hint">
              {schema.hidden_columns} colunas ocultas no modelo nao sao vistas pela IA.
            </p>
          )}

          <div className="ai-report-scroll">
            {tables.map((table) => (
              <details key={table.name} className="ai-report-table-block">
                <summary>
                  {table.name} ({table.columns.length} colunas
                  {table.measures.length > 0 ? `, ${table.measures.length} medidas` : ""})
                  {!table.in_prompt && <strong> fora do esquema da IA</strong>}
                </summary>
                {table.columns.length > 0 && (
                  <table className="ai-report-table">
                    <thead>
                      <tr>
                        <th>Coluna</th>
                        <th>Tipo</th>
                        <th>Valores diferentes</th>
                        <th>Bloquear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.columns.map((column) => (
                        <tr key={column.name}>
                          <td>{column.name}</td>
                          <td>{column.data_type ?? "-"}</td>
                          <td>{column.distinct === null ? "-" : column.distinct.toLocaleString("pt-BR")}</td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Bloquear ${table.name}[${column.name}]`}
                              checked={blockedKeys.has(columnKey({ table: table.name, column: column.name }))}
                              onChange={(e) => toggleBlocked(table.name, column.name, e.target.checked)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {table.measures.length > 0 && <p className="chat-hint">Medidas: {table.measures.join(", ")}</p>}
              </details>
            ))}
          </div>

          <label className="field" style={{ marginTop: 16 }}>
            Orientacoes para a IA
            <textarea
              className="input"
              rows={4}
              maxLength={MAX_NOTES}
              value={notes}
              placeholder='Por exemplo: "Unidade e o estado, na coluna dim_unidade[uf]. Custo assistencial e a medida [Custo Liquido]."'
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="chat-hint">
              {notes.length}/{MAX_NOTES}
            </span>
          </label>

          <label className="field" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={allowImages} onChange={(e) => setAllowImages(e.target.checked)} />
            Permitir que a IA veja a imagem da pagina aberta deste relatorio
          </label>
          <p className="chat-hint">
            A imagem mostra o que esta na tela (valores e, as vezes, nomes) e e enviada ao provedor de IA. So vale com o
            chat aberto dentro do relatorio e se o modelo escolhido aceitar imagens. Fica desligado ate voce ligar.
          </p>

          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      )}
    </section>
  );
}
