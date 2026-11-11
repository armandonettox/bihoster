import { useNavigate } from "react-router-dom";
import { useChat } from "../context/ChatContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useDropdownMenu } from "../hooks/useDropdownMenu";

/** Quadradinho da barra do topo: janela suspensa com os modulos do sistema (Administracao e Chat de IA).
 * Cada modulo so aparece para quem tem permissao; sem nenhum, o botao nem e mostrado. */
export default function AppsMenu() {
  const { open, setOpen, containerRef, triggerRef } = useDropdownMenu();
  const { workspaces } = useWorkspace();
  const { canUse: canUseChat, setPanelOpen } = useChat();
  const navigate = useNavigate();

  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  if (!isAnyAdmin && !canUseChat) return null;

  return (
    <div ref={containerRef} className="topbar-menu">
      <button
        ref={triggerRef}
        className="btn btn-ghost apps-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Modulos"
        aria-label="Modulos"
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
          {isAnyAdmin && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">admin_panel_settings</span>
              Administracao
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
