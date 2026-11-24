import { Link, useLocation } from "react-router-dom";
import { useAccess } from "../context/AccessContext";
import { useAnalyticsAccess } from "../hooks/useAnalyticsAccess";
import { ADMIN_AREA_KEYS, ALERTS_AREA_KEYS, COLLECTIONS_AREA_KEYS, SUBSCRIPTIONS_AREA_KEYS, USERS_AREA_KEYS } from "../utils/adminTabs";

/** Modulos do sistema na barra lateral (Gerenciar usuarios, Colecoes, Assinaturas, Alertas, Modo TV, Administracao e
 * Auditoria). Cada modulo so aparece para quem tem permissao; sem nenhum, nada e mostrado. O Chat de IA tem o seu
 * proprio item (ChatNavLink), porque abre um painel e nao uma pagina. */
export default function SidebarModules() {
  const access = useAccess();
  const { pathname } = useLocation();
  // Quem so tem a permissao de ver os analiticos entra direto no painel, sem a tabela de registros
  const { canView: canViewAnalytics } = useAnalyticsAccess();

  const canSeeAudit = access.can("auditoria.ver");
  const modules = [
    { show: access.canAny(...USERS_AREA_KEYS), to: "/users", icon: "group", label: "Gerenciar usuários" },
    { show: access.canAny(...COLLECTIONS_AREA_KEYS), to: "/collections", icon: "folder_copy", label: "Coleções" },
    { show: access.canAny(...SUBSCRIPTIONS_AREA_KEYS), to: "/subscriptions", icon: "forward_to_inbox", label: "Assinaturas" },
    { show: access.canAny(...ALERTS_AREA_KEYS), to: "/alerts", icon: "notifications_active", label: "Alertas" },
    { show: access.hasTvAccess, to: "/tv", icon: "tv", label: "Modo TV" },
    { show: access.canAny(...ADMIN_AREA_KEYS), to: "/settings", icon: "admin_panel_settings", label: "Administração" },
    { show: canSeeAudit, to: "/audit", icon: "fact_check", label: "Auditoria" },
    { show: canViewAnalytics && !canSeeAudit, to: "/audit", icon: "monitoring", label: "Analíticos" },
  ].filter((item) => item.show);

  return (
    <>
      {modules.map((item) => {
        const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.label}
            to={item.to}
            className={`sidebar-home-link ${active ? "sidebar-home-link-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="sidebar-home-icon material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
