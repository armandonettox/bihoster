import { useEffect, useState } from "react";
import * as chatApi from "../api/aiChat";
import type { AIUsageSummary } from "../api/aiChat";
import { formatUsd } from "../utils/chatFormat";

const PERIODS = [7, 30, 90];

const number = (value: number) => value.toLocaleString("pt-BR");

/** Consumo da IA para o admin: perguntas, tokens e custo por pessoa e por modelo, e a situacao do
 * orcamento do mes. Nao mostra texto de conversa. So o OpenRouter tem custo calculado. */
export default function AiUsageCard() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState<{ data: AIUsageSummary | null; errorDays: number | null }>({
    data: null,
    errorDays: null,
  });

  useEffect(() => {
    let cancelled = false;
    chatApi
      .getAIUsage(days)
      .then((data) => {
        if (!cancelled) setState({ data, errorDays: null });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, errorDays: days });
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Dado de outro periodo conta como "ainda carregando"
  const data = state.data && state.data.period_days === days ? state.data : null;

  return (
    <section className="settings-section" aria-label="Consumo da IA">
      <h2 className="settings-section-title">Consumo da IA</h2>
      <label className="field" style={{ maxWidth: 220 }}>
        Periodo
        <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((period) => (
            <option key={period} value={period}>
              Ultimos {period} dias
            </option>
          ))}
        </select>
      </label>

      {state.errorDays === days && <p className="auth-error">Nao foi possivel carregar o consumo.</p>}
      {!data && state.errorDays !== days && <p className="settings-section-desc">Carregando...</p>}

      {data && (
        <>
          <ul className="usage-summary">
            <li>
              Perguntas: <strong>{number(data.totals.questions)}</strong>
            </li>
            <li>
              Tokens: <strong>{number(data.totals.input_tokens)}</strong> de entrada e{" "}
              <strong>{number(data.totals.output_tokens)}</strong> de saida
            </li>
            <li>
              Custo no OpenRouter: <strong>{formatUsd(data.totals.cost_usd)}</strong>
            </li>
            <li>
              Limite por pessoa:{" "}
              <strong>{data.daily_limit === 0 ? "sem limite" : `${number(data.daily_limit)} perguntas por dia`}</strong>
            </li>
          </ul>
          {data.totals.unpriced_questions > 0 && (
            <p className="settings-section-desc">
              {data.totals.unpriced_questions} pergunta(s) do OpenRouter ficaram sem preco, porque o modelo nao esta na
              lista de precos deles. O custo delas nao entra na soma. Os outros provedores nao tem custo calculado.
            </p>
          )}

          <h3 className="usage-subtitle">Orcamento do mes (OpenRouter)</h3>
          {data.openrouter_budget.monthly_usd === null ? (
            <p className="settings-section-desc">Sem orcamento definido. Gasto no mes: {formatUsd(data.openrouter_budget.spent_month_usd)}.</p>
          ) : (
            <p className={data.openrouter_budget.blocked ? "auth-error" : "settings-section-desc"}>
              Gasto no mes: {formatUsd(data.openrouter_budget.spent_month_usd)} de {formatUsd(data.openrouter_budget.monthly_usd)}
              {data.openrouter_budget.remaining_usd !== null && ` (restam ${formatUsd(data.openrouter_budget.remaining_usd)})`}.
              {data.openrouter_budget.blocked &&
                " Orcamento atingido: o chat nao responde pelo OpenRouter ate o proximo mes ou ate o valor ser aumentado."}
            </p>
          )}

          <h3 className="usage-subtitle">Por pessoa</h3>
          {data.by_user.length === 0 ? (
            <p className="settings-section-desc">Nenhuma pergunta no periodo.</p>
          ) : (
            <div className="chat-table-wrap">
              <table className="chat-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th className="chat-table-number">Perguntas</th>
                    <th className="chat-table-number">Tokens (entrada / saida)</th>
                    <th className="chat-table-number">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_user.map((row) => (
                    <tr key={`${row.user_id}-${row.email}`}>
                      <td>{row.email ?? "Conta excluida"}</td>
                      <td className="chat-table-number">{number(row.questions)}</td>
                      <td className="chat-table-number">
                        {number(row.input_tokens)} / {number(row.output_tokens)}
                      </td>
                      <td className="chat-table-number">{formatUsd(row.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="usage-subtitle">Por modelo</h3>
          {data.by_model.length === 0 ? (
            <p className="settings-section-desc">Nenhuma pergunta no periodo.</p>
          ) : (
            <div className="chat-table-wrap">
              <table className="chat-table">
                <thead>
                  <tr>
                    <th>Provedor</th>
                    <th>Modelo</th>
                    <th className="chat-table-number">Perguntas</th>
                    <th className="chat-table-number">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_model.map((row) => (
                    <tr key={`${row.provider}-${row.model}`}>
                      <td>{row.provider}</td>
                      <td>{row.model}</td>
                      <td className="chat-table-number">{number(row.questions)}</td>
                      <td className="chat-table-number">
                        {row.provider === "openrouter" ? formatUsd(row.cost_usd) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
