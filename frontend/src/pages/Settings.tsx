import { useRef, type KeyboardEvent } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useUrlTab } from "../hooks/useUrlTab";
import PageLoading from "../components/PageLoading";
import GeneralTab from "./settings/GeneralTab";
import CollectionsTab from "./settings/CollectionsTab";
import BrandTab from "./settings/BrandTab";
import MembersTab from "./settings/MembersTab";
import GroupsTab from "./settings/GroupsTab";
import AuthTab from "./settings/AuthTab";
import AuditTab from "./settings/AuditTab";
import UpdatesTab from "./settings/UpdatesTab";
import AccountTab from "./settings/AccountTab";

type Tab = "general" | "collections" | "brand" | "members" | "groups" | "auth" | "audit" | "updates" | "account";

// Abas de administracao: so quem administra alguma colecao. O servidor protege cada rota de
// qualquer jeito; aqui e so o que a pessoa ve.
const ADMIN_TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "Geral" },
  { key: "collections", label: "Coleções" },
  { key: "brand", label: "Marca" },
  { key: "members", label: "Membros" },
  { key: "groups", label: "Grupos" },
  { key: "auth", label: "Autenticacao" },
  { key: "audit", label: "Auditoria" },
  { key: "updates", label: "Atualizacoes" },
];

// Todo usuario tem a sua conta, administre ou nao
const ACCOUNT_TAB: { key: Tab; label: string } = { key: "account", label: "Minha conta" };

export default function Settings() {
  const { workspaces, loading } = useWorkspace();
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  const tabs = isAnyAdmin ? [...ADMIN_TABS, ACCOUNT_TAB] : [ACCOUNT_TAB];

  // Aba na URL (?tab=): recarregar mantem a aba e da pra compartilhar um link direto; lembra a ultima.
  // Quem nao e admin so tem "account": qualquer outro valor na URL cai nela.
  const [tab, setTab] = useUrlTab<Tab>(
    tabs.map((t) => t.key),
    isAnyAdmin ? "general" : "account",
    { storageKey: "settings_tab" },
  );

  // Sem saber se a pessoa administra alguma colecao, nao da pra decidir quais abas mostrar
  if (loading) return <PageLoading />;

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
        <h1>{isAnyAdmin ? "Configuracoes" : "Minha conta"}</h1>
        <p>
          {isAnyAdmin
            ? "Gerencie a marca do sistema, colecoes, membros e grupos de acesso."
            : "Gerencie o seu nome e a sua senha."}
        </p>
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
        {tab === "audit" && <AuditTab />}
        {tab === "updates" && <UpdatesTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </div>
  );
}
