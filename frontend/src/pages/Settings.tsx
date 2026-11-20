import { useRef, type KeyboardEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAccess } from "../context/AccessContext";
import { useUrlTab } from "../hooks/useUrlTab";
import { ADMIN_TABS, type AdminTab } from "../utils/adminTabs";
import PageLoading from "../components/PageLoading";
import GeneralTab from "./settings/GeneralTab";
import CollectionsTab from "./settings/CollectionsTab";
import BrandTab from "./settings/BrandTab";
import AuthTab from "./settings/AuthTab";
import EmailTab from "./settings/EmailTab";
import UpdatesTab from "./settings/UpdatesTab";
import SubscriptionsTab from "./settings/SubscriptionsTab";
import CacheTab from "./settings/CacheTab";
import AiTab from "./settings/AiTab";

type Tab = AdminTab;

export default function Settings() {
  const access = useAccess();
  const [searchParams] = useSearchParams();
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // A conta da pessoa tem pagina propria (/account); aqui ficam so as abas de administracao que ela pode usar.
  const tabs = ADMIN_TABS.filter((t) => access.canAny(...t.keys));
  const onlyAi = tabs.length === 1 && tabs[0].key === "ai";

  // Aba na URL (?tab=): recarregar mantem a aba e da pra compartilhar um link direto; lembra a ultima.
  // Uma aba que a pessoa nao pode ver (na URL ou lembrada de antes) cai na primeira que ela pode.
  const [tab, setTab] = useUrlTab<Tab>(
    tabs.map((t) => t.key),
    tabs[0]?.key ?? "general",
    { storageKey: "settings_tab" },
  );

  // Sem saber o que a pessoa pode, nao da pra decidir quais abas mostrar
  if (access.loading) return <PageLoading />;

  // Sem nada para administrar, ou link antigo da aba da conta (/settings?tab=account): vai para a pagina da conta
  if (tabs.length === 0 || searchParams.get("tab") === "account") return <Navigate to="/account" replace />;

  // Link antigo da aba de auditoria (/settings?tab=audit): a auditoria tem pagina propria
  if (searchParams.get("tab") === "audit") return <Navigate to="/audit" replace />;

  // Links antigos das abas Membros e Grupos: agora ficam em Gerenciar usuarios
  if (searchParams.get("tab") === "members") return <Navigate to="/users" replace />;
  if (searchParams.get("tab") === "groups") return <Navigate to="/users?view=groups" replace />;

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
        <h1>Administração</h1>
        <p>{onlyAi ? "Gerencie a IA do sistema." : "Gerencie a marca, as coleções e as configurações do sistema."}</p>
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
        {tab === "auth" && <AuthTab />}
        {tab === "email" && <EmailTab />}
        {tab === "ai" && <AiTab />}
        {tab === "subscriptions" && <SubscriptionsTab />}
        {tab === "updates" && <UpdatesTab />}
        {tab === "cache" && <CacheTab />}
      </div>
    </div>
  );
}
