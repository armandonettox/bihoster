import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useTheme } from "../context/ThemeContext";

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const { workspaces } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  const initials = (user?.name || "?").slice(0, 2).toUpperCase();

  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // So registra os listeners globais enquanto o menu esta aberto -- sem isso, ficam ativos
    // (e rodando a cada clique/tecla na pagina inteira) durante toda a vida do componente.
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="topbar-menu">
      <button
        ref={triggerRef}
        className="btn btn-ghost account-menu-trigger"
        onClick={() => setOpen((prev) => !prev)}
        title="Menu da conta"
        aria-label="Menu da conta"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="account-menu-grid">
          <span />
          <span />
          <span />
          <span />
        </span>
        <div className="user-avatar">{initials}</div>
      </button>

      {open && (
        <div className="topbar-menu-dropdown account-menu-dropdown">
          <div className="account-menu-header">
            <div className="user-avatar">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div className="user-name" style={{ maxWidth: 200 }}>
                {user?.name}
              </div>
              <div className="account-menu-email">{user?.email}</div>
            </div>
          </div>

          <div className="topbar-menu-divider" />

          <button className="topbar-menu-item" onClick={toggleTheme}>
            {theme === "dark" ? "Modo claro" : "Modo escuro"}
          </button>

          <div className="topbar-menu-divider" />

          {isAnyAdmin && (
            <button
              className="topbar-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
            >
              Configuracoes
            </button>
          )}
          <button
            className="topbar-menu-item"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
