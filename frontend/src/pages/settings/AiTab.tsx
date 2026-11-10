import { useEffect, useState, type FormEvent } from "react";
import * as aiApi from "../../api/aiSettings";
import type { AIProvider } from "../../api/aiSettings";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { SkeletonList } from "../../components/Skeleton";
import AiOptionsCard from "../../components/AiOptionsCard";

interface CardProps {
  provider: AIProvider;
  onSaved: (saved: AIProvider) => void;
}

function ProviderCard({ provider, onSaved }: CardProps) {
  const { showToast } = useToast();

  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [model, setModel] = useState(provider.model ?? "");
  const [enabled, setEnabled] = useState(provider.enabled);
  // So guarda o que a pessoa marcou nesta tela; sem marcacao vale o que o servidor tem. Assim, quando
  // outro cartao vira o escolhido, este desmarca sozinho. Desativar o provedor tira ele do chat.
  const [chatChoice, setChatChoice] = useState<boolean | null>(null);
  const chatDefault = enabled && (chatChoice ?? provider.chat_default);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const keyConfigured = provider.api_key_configured && !clearKey;

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await aiApi.updateAIProvider(provider.provider, {
        model: model.trim() || null,
        enabled,
        chat_default: chatDefault,
        // Sem digitar nada a chave atual e mantida; "apagar" manda texto vazio
        ...(clearKey ? { api_key: "" } : apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      setApiKey("");
      setClearKey(false);
      setChatChoice(null);
      setModel(saved.model ?? "");
      setEnabled(saved.enabled);
      setTestResult(null);
      onSaved(saved);
      showToast(`${provider.label} salvo.`);
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      const result = await aiApi.testAIProvider(provider.provider);
      setTestResult({ ok: true, text: `Conexao ok com o modelo ${result.model} (${result.latency_ms} ms).` });
    } catch (err: any) {
      setTestResult({ ok: false, text: extractErrorMessage(err) || "Nao foi possivel testar a conexao." });
    } finally {
      setTesting(false);
    }
  }

  // O teste usa o que esta salvo, nao o que esta digitado na tela
  const canTest = provider.api_key_configured && !!provider.model;

  return (
    <section className="settings-section" aria-label={provider.label}>
      <h2 className="settings-section-title">{provider.label}</h2>
      <form onSubmit={handleSave}>
        <div className="settings-grid">
          <div>
            <label className="field">
              Chave de API
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                disabled={clearKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyConfigured ? "Ja cadastrada -- deixe em branco para manter" : ""}
              />
            </label>
            {provider.api_key_configured && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(e) => {
                    setClearKey(e.target.checked);
                    if (e.target.checked) setApiKey("");
                  }}
                />
                Apagar a chave salva
              </label>
            )}
          </div>
          <label className="field">
            Modelo
            <input
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={`Ex.: ${provider.example_model}`}
            />
          </label>
        </div>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Provedor ativo
        </label>
        <div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={chatDefault}
              disabled={!enabled}
              onChange={(e) => setChatChoice(e.target.checked)}
            />
            Usar este provedor no chat
          </label>
          {!enabled && (
            <p className="settings-section-desc" style={{ margin: "4px 0 0" }}>
              Ative o provedor para poder escolhe-lo para o chat.
            </p>
          )}
        </div>

        {error && <p className="auth-error">{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={testing || !canTest} onClick={handleTest}>
            {testing ? "Testando..." : "Testar conexao"}
          </button>
        </div>
        {!canTest && (
          <p className="settings-section-desc" style={{ marginTop: 8 }}>
            Salve a chave e o modelo para poder testar.
          </p>
        )}
        {testResult && (
          <p
            role="status"
            className={testResult.ok ? undefined : "auth-error"}
            style={testResult.ok ? { color: "var(--color-text-muted)", marginTop: 12 } : { marginTop: 12 }}
          >
            {testResult.text}
          </p>
        )}
      </form>
    </section>
  );
}

export default function AiTab() {
  const [providers, setProviders] = useState<AIProvider[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    aiApi
      .listAIProviders()
      .then((data) => {
        if (!cancelled) setProviders(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(saved: AIProvider) {
    // So um provedor responde o chat: quando o salvo virou o escolhido, os outros perdem a marca
    setProviders(
      (current) =>
        current?.map((p) =>
          p.provider === saved.provider ? saved : saved.chat_default ? { ...p, chat_default: false } : p,
        ) ?? current,
    );
  }

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as configuracoes de IA.</p>;
  if (!providers) return <SkeletonList count={3} />;

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Provedores de IA</h2>
        <p className="settings-section-desc">
          Cadastre a chave de API dos provedores que quiser usar. As chaves ficam so no servidor, cifradas, e nunca sao
          exibidas depois de salvas. Para usar um provedor, informe o modelo e marque como ativo. Escolha qual provedor ativo
          responde o chat com a opcao "Usar este provedor no chat": so um por vez.
        </p>
      </div>
      <AiOptionsCard />
      {providers.map((provider) => (
        <ProviderCard key={provider.provider} provider={provider} onSaved={handleSaved} />
      ))}
    </div>
  );
}
