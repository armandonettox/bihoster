import { useNavigate } from "react-router-dom";
import { useAccess } from "../context/AccessContext";
import { useChat } from "../context/ChatContext";
import { useAnalyticsAccess } from "../hooks/useAnalyticsAccess";
import { useDropdownMenu } from "../hooks/useDropdownMenu";
import { ADMIN_AREA_KEYS, ALERTS_AREA_KEYS, COLLECTIONS_AREA_KEYS, SUBSCRIPTIONS_AREA_KEYS, USERS_AREA_KEYS } from "../utils/adminTabs";

/** Quadradinho da barra do topo: janela suspensa com os modulos do sistema (Administracao, Auditoria e Chat de IA).
 * Cada modulo so aparece para quem tem permissao; sem nenhum, o botao nem e mostrado. */
export default function AppsMenu() {
  const { open, setOpen, containerRef, triggerRef } = useDropdownMenu();
  const { canUse: canUseChat, setPanelOpen } = useChat();
  const navigate = useNavigate();

  const access = useAccess();

  // A Administracao aparece para quem tem ao menos uma das abas dela; Gerenciar usuarios e uma area propria
  const isAnyAdmin = access.canAny(...ADMIN_AREA_KEYS);
  const canManageUsers = access.canAny(...USERS_AREA_KEYS);
  // Colecoes e Assinaturas tem pagina propria, cada uma aparece para quem tem o item que mostra a lista
  const canSeeCollections = access.canAny(...COLLECTIONS_AREA_KEYS);
  const canSeeSubscriptions = access.canAny(...SUBSCRIPTIONS_AREA_KEYS);
  const canSeeAlerts = access.canAny(...ALERTS_AREA_KEYS);
  const canSeeTv = access.hasTvAccess;
  // O log geral da auditoria tem permissao propria
  const canSeeAudit = access.can("auditoria.ver");
  // Quem so tem a permissao de ver os analiticos entra direto no painel, sem a tabela de registros
  const { canView: canViewAnalytics } = useAnalyticsAccess();
  const canSeeAnalytics = canViewAnalytics && !canSeeAudit;
  if (!isAnyAdmin && !canManageUsers && !canSeeCollections && !canSeeSubscriptions && !canSeeAlerts && !canSeeTv && !canUseChat && !canSeeAudit && !canSeeAnalytics) return null;

  return (
    <div ref={containerRef} className="topbar-menu">
      <button
        ref={triggerRef}
        className="btn btn-ghost apps-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Módulos"
        aria-label="Módulos"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="account-menu-grid">
          <span />
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div className="topbar-menu-dropdown">
          {canManageUsers && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/users");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">group</span>
              Gerenciar usuários
            </button>
          )}
          {canSeeCollections && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/collections");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">folder_copy</span>
              Coleções
            </button>
          )}
          {canSeeSubscriptions && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/subscriptions");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">forward_to_inbox</span>
              Assinaturas
            </button>
          )}
          {canSeeAlerts && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/alerts");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">notifications_active</span>
              Alertas
            </button>
          )}
          {canSeeTv && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/tv");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">tv</span>
              Modo TV
            </button>
          )}
          {isAnyAdmin && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">admin_panel_settings</span>
              Administração
            </button>
          )}
          {canSeeAudit && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/audit");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">fact_check</span>
              Auditoria
            </button>
          )}
          {canSeeAnalytics && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/audit");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">monitoring</span>
              Analíticos
            </button>
          )}
          {canUseChat && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                setPanelOpen(true);
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">chat</span>
              Chat de IA
            </button>
          )}
        </div>
      )}
    </div>
  );
}
