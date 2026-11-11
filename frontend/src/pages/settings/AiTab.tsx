import { useEffect, useState } from "react";
import * as aiApi from "../../api/aiSettings";
import type { AIProvider } from "../../api/aiSettings";
import { SkeletonList } from "../../components/Skeleton";
import AiLogCard from "../../components/AiLogCard";
import AiOptionsCard from "../../components/AiOptionsCard";
import AiProviderPanel from "../../components/AiProviderPanel";
import AiReportCard from "../../components/AiReportCard";
import AiUsageCard from "../../components/AiUsageCard";

function statusLabel(provider: AIProvider): string {
  if (provider.chat_default) return "ativo, padrao do chat";
  if (provider.enabled) return "ativo";
  if (provider.api_key_configured) return "chave salva, inativo";
  return "sem chave";
}

/** Comeca no provedor que responde o chat; sem ele, no primeiro ativo; sem nenhum, no primeiro da lista */
function firstSelection(providers: AIProvider[]): string {
  return (providers.find((p) => p.chat_default) ?? providers.find((p) => p.enabled) ?? providers[0])?.provider ?? "";
}

export default function AiTab() {
  const [providers, setProviders] = useState<AIProvider[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState("");
  // Modelos ja consultados, por provedor: trocar de provedor e voltar nao consulta de novo
  const [models, setModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    aiApi
      .listAIProviders()
      .then((data) => {
        if (cancelled) return;
        setProviders(data);
        setSelected(firstSelection(data));
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

  function handleModels(provider: string, list: string[] | null) {
    setModels((current) => {
      const next = { ...current };
      if (list) next[provider] = list;
      else delete next[provider];
      return next;
    });
  }

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as configuracoes de IA.</p>;
  if (!providers) return <SkeletonList count={3} />;

  const current = providers.find((p) => p.provider === selected) ?? providers[0];

  return (
    <div>
      <section className="settings-section" aria-label="Provedor de IA">
        <h2 className="settings-section-title">Provedor de IA</h2>
        <p className="settings-section-desc">
          Escolha um provedor, cadastre a chave de API e o modelo e marque como ativo. As chaves ficam so no servidor,
          cifradas, e nunca sao exibidas depois de salvas. Qual provedor ativo responde o chat e escolhido com a opcao
          "Usar este provedor no chat": so um por vez.
        </p>
        <label className="field" style={{ maxWidth: 360 }}>
          Provedor
          <select className="input" value={current.provider} onChange={(e) => setSelected(e.target.value)}>
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.label} ({statusLabel(p)})
              </option>
            ))}
          </select>
        </label>
        <div style={{ marginTop: 16 }}>
          <AiProviderPanel
            key={current.provider}
            provider={current}
            onSaved={handleSaved}
            models={models[current.provider]}
            onModels={handleModels}
          />
        </div>
      </section>
      <AiLogCard />
      <AiReportCard />
      <AiOptionsCard />
      <AiUsageCard />
    </div>
  );
}
