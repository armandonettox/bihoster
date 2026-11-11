import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useDropdownMenu } from "../hooks/useDropdownMenu";
import UserAvatar from "./UserAvatar";

/** Foto (ou iniciais) do perfil na barra do topo: abre Minha conta e Sair. Os modulos ficam no AppsMenu. */
export default function AccountMenu() {
  const { open, setOpen, containerRef, triggerRef } = useDropdownMenu();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
        <UserAvatar name={user?.name} pictureUrl={user?.picture_url} />
      </button>

      {open && (
        <div className="topbar-menu-dropdown account-menu-dropdown">
          <div className="account-menu-header">
            <UserAvatar name={user?.name} pictureUrl={user?.picture_url} />
            <div style={{ minWidth: 0 }}>
              <div className="user-name" style={{ maxWidth: 200 }}>
                {user?.name}
              </div>
              <div className="account-menu-email">{user?.email}</div>
            </div>
          </div>

          <div className="topbar-menu-divider" />

          <button
            className="topbar-menu-item"
            onClick={() => {
              setOpen(false);
              navigate("/account");
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">manage_accounts</span>
            Minha conta
          </button>
          <button
            className="topbar-menu-item"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">logout</span>
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
