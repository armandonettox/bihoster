import { useRef, type KeyboardEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import { useUrlTab } from "../hooks/useUrlTab";
import { useAiAccess } from "../hooks/useAiAccess";
import PageLoading from "../components/PageLoading";
import GeneralTab from "./settings/GeneralTab";
import CollectionsTab from "./settings/CollectionsTab";
import BrandTab from "./settings/BrandTab";
import MembersTab from "./settings/MembersTab";
import GroupsTab from "./settings/GroupsTab";
import AuthTab from "./settings/AuthTab";
import EmailTab from "./settings/EmailTab";
import AuditTab from "./settings/AuditTab";
import UpdatesTab from "./settings/UpdatesTab";
import SubscriptionsTab from "./settings/SubscriptionsTab";
import PermissoesTab from "./settings/PermissoesTab";
import CacheTab from "./settings/CacheTab";
import AiTab from "./settings/AiTab";

type Tab = "general" | "collections" | "brand" | "members" | "groups" | "auth" | "email" | "ai" | "subscriptions" | "audit" | "updates" | "permissoes" | "cache";

// A aba de IA aparece para quem tem a permissao "Gerenciar IA" (grupos), administre ou nao alguma colecao
const AI_TAB: { key: Tab; label: string } = { key: "ai", label: "IA" };

// Abas de administracao: so quem administra alguma colecao. O servidor protege cada rota de
// qualquer jeito; aqui e so o que a pessoa ve.
const ADMIN_TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "Geral" },
  { key: "collections", label: "Coleções" },
  { key: "brand", label: "Marca" },
  { key: "members", label: "Membros" },
  { key: "groups", label: "Grupos" },
  { key: "auth", label: "Autenticacao" },
  { key: "email", label: "E-mail" },
  AI_TAB,
  { key: "subscriptions", label: "Assinaturas" },
  { key: "permissoes", label: "Permissoes" },
  { key: "audit", label: "Auditoria" },
  { key: "updates", label: "Atualizacoes" },
  { key: "cache", label: "Cache" },
];

export default function Settings() {
  const { workspaces, loading } = useWorkspace();
  const { canManage: canManageAi, loading: aiLoading } = useAiAccess();
  const [searchParams] = useSearchParams();
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  const adminTabs = ADMIN_TABS.filter((t) => t.key !== AI_TAB.key || canManageAi);
  // A conta da pessoa tem pagina propria (/account); aqui ficam so as abas de administracao.
  const tabs = isAnyAdmin ? adminTabs : canManageAi ? [AI_TAB] : [];

  // Aba na URL (?tab=): recarregar mantem a aba e da pra compartilhar um link direto; lembra a ultima.
  // Quem nao e admin so tem a aba de IA (se gerenciar): qualquer outro valor na URL cai nela.
  const [tab, setTab] = useUrlTab<Tab>(
    tabs.map((t) => t.key),
    isAnyAdmin ? "general" : "ai",
    { storageKey: "settings_tab" },
  );

  // Sem saber se a pessoa administra alguma colecao nem se gerencia a IA, nao da pra decidir quais abas mostrar
  if (loading || aiLoading) return <PageLoading />;

  // Sem nada para administrar, ou link antigo da aba da conta (/settings?tab=account): vai para a pagina da conta
  if (tabs.length === 0 || searchParams.get("tab") === "account") return <Navigate to="/account" replace />;

  function focusTab(key: Tab) {
    setTab(key);
    tabButtonRefs.current[key]?.focus();
  }

  function handleTabsKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.key === tab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusTab(tabs[(index + 1) % tabs.length].key);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusTab(tabs[(index - 1 + tabs.length) % tabs.length].key);
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Configuracoes</h1>
        <p>{isAnyAdmin ? "Gerencie a marca do sistema, colecoes, membros e grupos de acesso." : "Gerencie a IA do sistema."}</p>
      </div>

      {tabs.length > 1 && (
        <div className="settings-tabs" role="tablist" onKeyDown={handleTabsKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                tabButtonRefs.current[t.key] = el;
              }}
              id={`settings-tab-${t.key}`}
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`settings-tabpanel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              className={`settings-tab ${tab === t.key ? "settings-tab-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" id={`settings-tabpanel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {tab === "general" && <GeneralTab />}
        {tab === "collections" && <CollectionsTab />}
        {tab === "brand" && <BrandTab />}
        {tab === "members" && <MembersTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "auth" && <AuthTab />}
        {tab === "email" && <EmailTab />}
        {tab === "ai" && <AiTab />}
        {tab === "subscriptions" && <SubscriptionsTab />}
        {tab === "permissoes" && <PermissoesTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "updates" && <UpdatesTab />}
        {tab === "cache" && <CacheTab />}
      </div>
    </div>
  );
}
