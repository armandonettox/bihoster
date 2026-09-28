import { useState, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import GeneralTab from "./settings/GeneralTab";
import CollectionsTab from "./settings/CollectionsTab";
import BrandTab from "./settings/BrandTab";
import MembersTab from "./settings/MembersTab";
import GroupsTab from "./settings/GroupsTab";
import AuthTab from "./settings/AuthTab";
import AuditTab from "./settings/AuditTab";
import UpdatesTab from "./settings/UpdatesTab";

type Tab = "general" | "collections" | "brand" | "members" | "groups" | "auth" | "audit" | "updates";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "Geral" },
  { key: "collections", label: "Coleções" },
  { key: "brand", label: "Marca" },
  { key: "members", label: "Membros" },
  { key: "groups", label: "Grupos" },
  { key: "auth", label: "Autenticacao" },
  { key: "audit", label: "Auditoria" },
  { key: "updates", label: "Atualizacoes" },
];

export default function Settings() {
  const { workspaces } = useWorkspace();
  const [tab, setTab] = useState<Tab>("general");
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const isAnyAdmin = workspaces.some((w) => w.role === "admin");

  if (!isAnyAdmin) {
    return (
      <div className="empty-state" style={{ alignItems: "center", textAlign: "center", padding: "60px 20px" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-text-muted)" }}>
          lock
        </span>
        <p style={{ color: "var(--color-text-muted)", margin: "8px 0 4px" }}>
          Voce nao tem permissao para acessar esta pagina.
        </p>
        <Link to="/" className="btn btn-secondary btn-sm">
          Voltar ao inicio
        </Link>
      </div>
    );
  }

  function focusTab(key: Tab) {
    setTab(key);
    tabButtonRefs.current[key]?.focus();
  }

  function handleTabsKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((t) => t.key === tab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusTab(TABS[(index + 1) % TABS.length].key);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusTab(TABS[(index - 1 + TABS.length) % TABS.length].key);
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Configuracoes</h1>
        <p>Gerencie a marca do sistema, colecoes, membros e grupos de acesso.</p>
      </div>

      <div className="settings-tabs" role="tablist" onKeyDown={handleTabsKeyDown}>
        {TABS.map((t) => (
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

      <div role="tabpanel" id={`settings-tabpanel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {tab === "general" && <GeneralTab />}
        {tab === "collections" && <CollectionsTab />}
        {tab === "brand" && <BrandTab />}
        {tab === "members" && <MembersTab />}
        {tab === "groups" && <GroupsTab />}
        {tab === "auth" && <AuthTab />}
        {tab === "audit" && <AuditTab />}
        {tab === "updates" && <UpdatesTab />}
      </div>
    </div>
  );
}
