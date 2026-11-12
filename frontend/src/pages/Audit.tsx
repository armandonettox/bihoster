import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { getAuditOptions, type AuditFilters, type AuditOptions } from "../api/audit";
import AuditAnalytics from "../components/audit/AuditAnalytics";
import AuditFiltersBar from "../components/audit/AuditFilters";
import AuditTable from "../components/audit/AuditTable";
import { useAuth } from "../context/AuthContext";
import { useBranding } from "../context/BrandingContext";
import { useUrlTab } from "../hooks/useUrlTab";
import { DEFAULT_FILTERS, toggleFilter, type AuditFilterState } from "../utils/auditFilterState";
import { periodRange } from "../utils/auditPeriod";

type Tab = "records" | "analytics";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "records", label: "Registros", icon: "table_rows" },
  { key: "analytics", label: "Analiticos", icon: "monitoring" },
];

/** Pagina propria da auditoria (so administrador da plataforma): tabela com busca e analiticos,
 * as duas abas com os mesmos filtros. */
export default function Audit() {
  const { user } = useAuth();
  const { settings } = useBranding();
  const [tab, setTab] = useUrlTab<Tab>(["records", "analytics"], "records", { storageKey: "audit_tab" });
  const [filterState, setFilterState] = useState<AuditFilterState>(DEFAULT_FILTERS);
  const [options, setOptions] = useState<AuditOptions | null>(null);

  const timezone = settings?.timezone;

  useEffect(() => {
    let cancelled = false;
    getAuditOptions()
      .then((data) => !cancelled && setOptions(data))
      .catch(() => {
        // Sem as opcoes os seletores ficam so com "Todas"; a tabela continua funcionando
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filters = useMemo<AuditFilters>(() => {
    const range = periodRange(filterState.period, timezone, { from: filterState.customFrom, to: filterState.customTo });
    return {
      ...range,
      user_id: filterState.userIds.length > 0 ? filterState.userIds.map(Number) : undefined,
      action: filterState.actions.length > 0 ? filterState.actions : undefined,
      entity: filterState.entities.length > 0 ? filterState.entities : undefined,
      workspace_id: filterState.workspaceIds.length > 0 ? filterState.workspaceIds.map(Number) : undefined,
      report_id: filterState.reportIds.length > 0 ? filterState.reportIds.map(Number) : undefined,
    };
  }, [filterState, timezone]);

  if (!user?.is_platform_admin) return <Navigate to="/" replace />;

  return (
    <div className="settings-page audit-page">
      <div className="settings-header">
        <h1>Auditoria</h1>
        <p>
          Historico de acoes no sistema: acessos, mudancas de configuracao e de permissao. Horarios no fuso{" "}
          {timezone || "America/Sao_Paulo"} (configuravel em Geral).
        </p>
      </div>

      <div className="settings-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`audit-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`audit-tabpanel-${t.key}`}
            className={`settings-tab ${tab === t.key ? "settings-tab-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <AuditFiltersBar value={filterState} options={options} onChange={setFilterState} />

      <div role="tabpanel" id={`audit-tabpanel-${tab}`} aria-labelledby={`audit-tab-${tab}`}>
        {tab === "records" ? (
          <AuditTable
            filters={filters}
            timezone={timezone}
            people={options?.users}
            onFilterBy={(patch) => setFilterState((current) => ({ ...current, ...patch }))}
          />
        ) : (
          <AuditAnalytics
            filters={filters}
            canEdit={user?.is_platform_admin === true}
            onFilterBy={(patch) => setFilterState((current) => toggleFilter(current, patch))}
          />
        )}
      </div>
    </div>
  );
}
