import { useEffect, useState } from "react";
import * as aiApi from "../../api/aiSettings";
import type { AIProvider } from "../../api/aiSettings";
import AdminSectionModal from "../../components/AdminSectionModal";
import SettingsRowList, { type SettingsRow } from "../../components/SettingsRowList";
import { SkeletonList } from "../../components/Skeleton";
import { useAccess } from "../../context/AccessContext";
import AiLogCard from "../../components/AiLogCard";
import AiOptionsCard from "../../components/AiOptionsCard";
import AiProviderPanel from "../../components/AiProviderPanel";
import AiReportCard from "../../components/AiReportCard";
import AiUsageCard from "../../components/AiUsageCard";

type Editing = "providers" | "log" | "reports" | "options" | "usage" | null;

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
  // Cada parte da IA tem a sua permissao: a pessoa ve so as linhas dos itens que tem. Os provedores (chaves) so sao
  // buscados por quem tem o item das chaves.
  const access = useAccess();
  const canKeys = access.can("ia.chaves");
  const [providers, setProviders] = useState<AIProvider[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState("");
  // Modelos ja consultados, por provedor: trocar de provedor e voltar nao consulta de novo
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  useEffect(() => {
    if (!canKeys) return;
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
  }, [canKeys]);

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

  if (canKeys && loadError) return <p className="auth-error">Nao foi possivel carregar as configuracoes de IA.</p>;
  if (canKeys && !providers) return <SkeletonList count={3} />;

  const current = providers ? (providers.find((p) => p.provider === selected) ?? providers[0]) : null;
  const chatProvider = providers?.find((p) => p.chat_default);
  const activeCount = providers?.filter((p) => p.enabled).length ?? 0;

  const rows: SettingsRow[] = [];
  if (providers && current) {
    rows.push({
      key: "providers",
      label: "Provedor de IA",
      description: "Os provedores, as chaves de API e os modelos, e qual deles responde o chat.",
      summary: chatProvider ? `Responde o chat: ${chatProvider.label}` : "Nenhum provedor responde o chat",
      status: activeCount > 0 ? `${activeCount} ativo${activeCount > 1 ? "s" : ""}` : "Sem provedor ativo",
      highlight: activeCount > 0,
      onEdit: () => setEditing("providers"),
    });
  }
  if (access.can("ia.registro")) {
    rows.push({
      key: "log",
      label: "Registro das respostas",
      description: "As perguntas feitas ao chat e as respostas dadas, para conferir e auditar.",
      actionLabel: "Abrir",
      onEdit: () => setEditing("log"),
    });
  }
  if (access.can("ia.bloqueios")) {
    rows.push({
      key: "reports",
      label: "Relatórios e o chat",
      description: "O que o chat pode consultar de cada relatório, com bloqueio de tabelas e colunas.",
      onEdit: () => setEditing("reports"),
    });
  }
  if (access.can("ia.modelos")) {
    rows.push({
      key: "options",
      label: "Chat: histórico, limites e orçamento",
      description: "Quanto do histórico o chat lembra, os limites de uso e o orçamento do mês.",
      onEdit: () => setEditing("options"),
    });
  }
  if (access.can("ia.consumo")) {
    rows.push({
      key: "usage",
      label: "Consumo da IA",
      description: "Quanto se usou nos últimos dias, por pessoa e por modelo.",
      actionLabel: "Abrir",
      onEdit: () => setEditing("usage"),
    });
  }

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Inteligência artificial</h2>
        <p className="settings-section-desc">
          O provedor, o que o chat pode ver e quanto ele gasta. Abra uma parte para ajustar ou consultar.
        </p>
        <SettingsRowList rows={rows} />
      </div>

      {editing === "providers" && providers && current && (
        <AdminSectionModal title="Provedor de IA" onClose={close}>
          <section aria-label="Provedor de IA">
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
        </AdminSectionModal>
      )}
      {editing === "log" && (
        <AdminSectionModal title="Registro das respostas" onClose={close}>
          <AiLogCard />
        </AdminSectionModal>
      )}
      {editing === "reports" && (
        <AdminSectionModal title="Relatórios e o chat" onClose={close}>
          <AiReportCard />
        </AdminSectionModal>
      )}
      {editing === "options" && (
        <AdminSectionModal title="Chat: histórico, limites e orçamento" onClose={close}>
          <AiOptionsCard />
        </AdminSectionModal>
      )}
      {editing === "usage" && (
        <AdminSectionModal title="Consumo da IA" onClose={close}>
          <AiUsageCard />
        </AdminSectionModal>
      )}
    </div>
  );
}
