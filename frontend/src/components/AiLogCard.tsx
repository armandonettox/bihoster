import { useEffect, useRef, useState } from "react";
import * as aiLogApi from "../api/aiLog";
import type { AILog, AILogEntry } from "../api/aiLog";
import { extractErrorMessage } from "../api/client";

const PERIODS = [1, 7, 30];

/** Como cada pergunta terminou, nas palavras de quem administra */
const OUTCOME_LABELS: Record<string, string> = {
  answered: "Respondeu",
  empty_answer: "Sem texto final",
  model_reply: "A IA explicou sem consultar",
  off_topic: "Recusa padrao",
  needs_detail: "Pediu mais detalhe",
  blocked: "Bloqueado",
  no_dax: "Consulta falhou",
  no_report: "Nao achou o relatorio",
  no_reports: "Sem relatorios",
  error: "Erro",
};

const STEP_LABELS: Record<string, string> = {
  escolher_relatorio: "Escolher o relatorio",
  ler_esquema: "Ler o esquema",
  gerar_consulta: "Gerar a consulta",
  refazer_consulta: "Refazer a consulta",
  power_bi: "Consultar o Power BI",
  escrever_resposta: "Escrever a resposta",
};

const number = (value: number) => value.toLocaleString("pt-BR");

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

function stepLabel(step: string): string {
  // "gerar_consulta (nova tentativa)" e "(sem imagem)" mantem o complemento
  const match = step.match(/^([a-z_]+)(.*)$/);
  const base = match ? (STEP_LABELS[match[1]] ?? match[1]) : step;
  return `${base}${match ? match[2] : ""}`;
}

function isProblem(outcome: string): boolean {
  return !["answered", "blocked", "no_reports"].includes(outcome);
}

/** Registro das perguntas ao chat para o admin: o que foi perguntado, o que a IA respondeu, qual provedor e modelo
 * e quanto tempo cada passo levou. Serve para achar respostas ruins e entender falhas. Fica 30 dias. */
export default function AiLogCard() {
  const [days, setDays] = useState(7);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [log, setLog] = useState<AILog | null>(null);
  const [entries, setEntries] = useState<AILogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Cada pedido tem um numero: resposta de um filtro antigo nao sobrescreve a do filtro atual
  const requestRef = useRef(0);

  async function load(beforeId?: number) {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await aiLogApi.getAILog({ days, onlyProblems, beforeId });
      if (request !== requestRef.current) return;
      setLog(data);
      setEntries((current) => (beforeId === undefined ? data.entries : [...current, ...data.entries]));
    } catch (err: any) {
      if (request !== requestRef.current) return;
      setError(extractErrorMessage(err) || "Nao foi possivel carregar o registro.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, onlyProblems]);

  return (
    <section className="settings-section" aria-label="Registro das respostas">
      <h2 className="settings-section-title">Registro das respostas</h2>
      <p className="settings-section-desc">
        O que as pessoas perguntaram e o que a IA respondeu, com provedor, modelo e tempo de cada passo. Use para achar
        respostas ruins e entender falhas. Guarda a pergunta, a resposta e a consulta, nunca as linhas das tabelas, e se
        apaga sozinho depois de {log?.retention_days ?? 30} dias. So quem gerencia a IA ve esta lista.
      </p>

      <div className="ai-log-filters">
        <label className="field" style={{ maxWidth: 220 }}>
          Periodo
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((period) => (
              <option key={period} value={period}>
                {period === 1 ? "Ultimo dia" : `Ultimos ${period} dias`}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          So respostas com problema
        </label>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {loading && entries.length === 0 && !error && <p className="settings-section-desc">Carregando...</p>}

      {log && log.by_model.length > 0 && (
        <div className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                <th>Provedor</th>
                <th>Modelo</th>
                <th className="chat-table-number">Perguntas</th>
                <th className="chat-table-number">Com problema</th>
                <th className="chat-table-number">Tempo medio</th>
                <th className="chat-table-number">Tempo p95</th>
              </tr>
            </thead>
            <tbody>
              {log.by_model.map((row) => (
                <tr key={`${row.provider}-${row.model}`}>
                  <td>{row.provider}</td>
                  <td>{row.model}</td>
                  <td className="chat-table-number">{number(row.questions)}</td>
                  <td className="chat-table-number">
                    {number(row.problems)} ({Math.round((row.problems / row.questions) * 100)}%)
                  </td>
                  <td className="chat-table-number">{formatSeconds(row.avg_ms)}</td>
                  <td className="chat-table-number">{formatSeconds(row.p95_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log && !loading && entries.length === 0 && !error && (
        <p className="settings-section-desc">
          {onlyProblems ? "Nenhuma resposta com problema no periodo." : "Nenhuma pergunta no periodo."}
        </p>
      )}

      <div className="ai-log-list">
        {entries.map((entry) => (
          <details key={entry.id} className={`ai-log-entry${isProblem(entry.outcome) ? " ai-log-entry-problem" : ""}`}>
            <summary>
              <span className="ai-log-when">{new Date(entry.created_at).toLocaleString("pt-BR")}</span>{" "}
              <strong>{OUTCOME_LABELS[entry.outcome] ?? entry.outcome}</strong> - {entry.user_email ?? "conta excluida"} -{" "}
              {entry.provider} / {entry.model} - {formatSeconds(entry.duration_ms)}
              {entry.question && <span className="ai-log-question"> - {entry.question}</span>}
            </summary>
            <div className="ai-log-body">
              <p>
                <strong>Pergunta:</strong> {entry.question ?? "-"}
              </p>
              <p>
                <strong>Resposta:</strong> {entry.reply ?? "(sem resposta)"}
              </p>
              {entry.error && (
                <p className="auth-error">
                  <strong>Erro:</strong> {entry.error}
                </p>
              )}
              <p className="chat-hint">
                Relatorio: {entry.report_name ?? "nenhum"} - {number(entry.llm_calls)} chamadas a IA -{" "}
                {number(entry.input_tokens)} tokens de entrada e {number(entry.output_tokens)} de saida
                {entry.used_image ? " - com imagem da pagina" : ""}
              </p>
              {entry.dax && (
                <details className="chat-dax">
                  <summary>Consulta DAX</summary>
                  <pre>{entry.dax}</pre>
                </details>
              )}
              {entry.steps.length > 0 && (
                <div className="chat-table-wrap">
                  <table className="chat-table">
                    <thead>
                      <tr>
                        <th>Passo</th>
                        <th className="chat-table-number">Tempo</th>
                        <th className="chat-table-number">Tokens (entrada / saida)</th>
                        <th className="chat-table-number">Pensando</th>
                        <th>Parou por</th>
                        <th>Obs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.steps.map((step, index) => (
                        <tr key={`${step.step}-${index}`}>
                          <td>{stepLabel(step.step)}</td>
                          <td className="chat-table-number">{step.ms === undefined ? "-" : formatSeconds(step.ms)}</td>
                          <td className="chat-table-number">
                            {step.input_tokens === undefined ? "-" : `${number(step.input_tokens)} / ${number(step.output_tokens ?? 0)}`}
                          </td>
                          <td className="chat-table-number">
                            {step.reasoning_tokens === undefined ? "-" : number(step.reasoning_tokens)}
                          </td>
                          <td>{step.finish_reason || "-"}</td>
                          <td>
                            {[
                              step.error ? `erro: ${step.error}` : "",
                              step.json_ok === false ? "JSON invalido" : "",
                              step.text_chars === 0 ? "resposta vazia" : "",
                              step.rows !== undefined ? `${number(step.rows)} linhas` : "",
                            ]
                              .filter(Boolean)
                              .join("; ") || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>

      {log?.next_before_id != null && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => void load(log.next_before_id ?? undefined)}
        >
          Carregar mais
        </button>
      )}
    </section>
  );
}
