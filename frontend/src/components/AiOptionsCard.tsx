import { useEffect, useState, type FormEvent } from "react";
import * as aiApi from "../api/aiSettings";
import type { AIOptions } from "../api/aiSettings";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";

/** Opcoes do chat de IA: por quanto tempo o historico fica guardado, quantas perguntas cada pessoa pode
 * fazer por dia e o orcamento mensal do OpenRouter. */
export default function AiOptionsCard() {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState<AIOptions | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [retention, setRetention] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fill(data: AIOptions) {
    setLoaded(data);
    setRetention(String(data.retention_days));
    setDailyLimit(String(data.daily_question_limit));
    setBudget(data.openrouter_monthly_budget_usd === null ? "" : String(data.openrouter_monthly_budget_usd));
  }

  useEffect(() => {
    let cancelled = false;
    aiApi
      .getAIOptions()
      .then((data) => {
        if (!cancelled) fill(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await aiApi.updateAIOptions({
        // Campo em branco nao vai no pedido: o servidor mantem o valor atual. Orcamento em branco
        // tira o orcamento (0).
        ...(retention.trim() ? { retention_days: Number(retention) } : {}),
        ...(dailyLimit.trim() ? { daily_question_limit: Number(dailyLimit) } : {}),
        openrouter_monthly_budget_usd: budget.trim() ? Number(budget) : 0,
      });
      fill(saved);
      showToast("Opcoes do chat salvas.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as opcoes do chat.</p>;
  if (!loaded) return null;

  return (
    <section className="settings-section" aria-label="Opcoes do chat">
      <h2 className="settings-section-title">Chat: historico, limites e orcamento</h2>
      <form onSubmit={handleSave}>
        <div className="settings-grid">
          <label className="field">
            Dias de guarda do historico
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              step={1}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              Conversas sem mensagem nova por mais tempo que isso sao apagadas sozinhas. Padrao: {loaded.default_retention_days}.
            </span>
          </label>
          <label className="field">
            Perguntas por pessoa por dia
            <input
              className="input"
              type="number"
              min={0}
              step={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              0 quer dizer sem limite. Padrao: {loaded.default_daily_question_limit}.
            </span>
          </label>
          <label className="field">
            Orcamento mensal do OpenRouter (US$)
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Sem orcamento"
            />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              Ao chegar nesse valor no mes, o chat para de responder pelo OpenRouter. Em branco ou 0, sem orcamento. Os
              outros provedores ficam so com o limite de perguntas.
            </span>
          </label>
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>
          {saving ? "Salvando..." : "Salvar opcoes"}
        </button>
      </form>
    </section>
  );
}
