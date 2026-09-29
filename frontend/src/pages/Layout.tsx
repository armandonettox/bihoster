import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useBranding } from "../context/BrandingContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useFavorites } from "../context/FavoritesContext";
import type { Report } from "../api/reports";
import CollectionList from "../components/CollectionList";
import SearchBar from "../components/SearchBar";
import AccountMenu from "../components/AccountMenu";
import DefaultBrandLogo from "../components/DefaultBrandLogo";
import { assetUrl } from "../api/client";
import { safeStorage } from "../utils/safeStorage";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

export default function Layout() {
  const { settings } = useBranding();
  const { currentWorkspace, workspaces, selectWorkspace } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();

  const { favorites, toggleFavorite } = useFavorites();
  const [collapsed, setCollapsed] = useState(() => {
    const stored = safeStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) return stored === "1";
    // Sem preferencia salva -- comeca recolhida em telas estreitas, onde a
    // sidebar vira um overlay por cima do conteudo em vez de dividir a largura.
    return typeof window !== "undefined" && window.innerWidth < 768;
  });

  // Em tela estreita a sidebar e um overlay por cima do conteudo: fecha ao navegar (escolher
  // colecao, favorito etc), senao ela continua cobrindo a pagina nova. Nao grava a preferencia
  // em storage, pra nao sobrescrever o que o usuario escolheu no desktop.
  useEffect(() => {
    if (window.innerWidth < 768) setCollapsed(true);
  }, [location.key]);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      safeStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  function openFavorite(favorite: Report) {
    if (favorite.collection_id !== currentWorkspace?.id) {
      selectWorkspace(favorite.collection_id);
    }
    navigate("/collection");
  }

  function workspaceName(workspaceId: number): string {
    return workspaces.find((w) => w.id === workspaceId)?.name || "";
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="flex-row gap-md">
          <button
            onClick={toggleSidebar}
            className="btn btn-ghost sidebar-toggle-btn"
            title={collapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
            aria-label={collapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
          >
            <span className="hamburger-icon">
              <span />
              <span />
              <span />
            </span>
          </button>
          <Link to="/" className="topbar-brand">
            {settings?.logo_url ? (
              <img src={assetUrl(settings.logo_url)} alt="Logo" className="topbar-logo" />
            ) : (
              <DefaultBrandLogo variant="icon" className="topbar-logo" />
            )}
            <span className="topbar-brand-name">{settings?.company_name || "BIHoster"}</span>
          </Link>
          <SearchBar />
        </div>
        <div className="flex-row gap-sm">
          <AccountMenu />
        </div>
      </header>

      <div className="app-body">
        {!collapsed && <div className="app-body-overlay" onClick={toggleSidebar} />}
        {!collapsed && (
          <aside className="sidebar">
            <div className="sidebar-scroll">
              <div className="sidebar-section">
                <Link
                  to="/"
                  className={`sidebar-home-link ${location.pathname === "/" ? "sidebar-home-link-active" : ""}`}
                >
                  <span className="sidebar-home-icon material-symbols-outlined">home</span>
                  Inicio
                </Link>
              </div>

              {favorites.length > 0 && (
                <div className="sidebar-section">
                  <p className="sidebar-section-title">Favoritos</p>
                  {favorites.map((favorite) => (
                    <div
                      key={favorite.id}
                      className={`tree-item ${currentWorkspace?.id === favorite.collection_id ? "tree-item-active" : ""}`}
                    >
                      <button className="tree-item-link" onClick={() => openFavorite(favorite)} title={workspaceName(favorite.collection_id)}>
                        <span className="tree-item-link-name">{favorite.name}</span>
                        <span className="tree-item-link-collection">{workspaceName(favorite.collection_id)}</span>
                      </button>
                      <button
                        onClick={() => toggleFavorite(favorite.id)}
                        title="Remover dos favoritos"
                        className="tree-item-star tree-item-star-active"
                      >
                        ★
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="sidebar-section">
                <p className="sidebar-section-title">Colecoes</p>
                <CollectionList />
              </div>
            </div>
          </aside>
        )}

        <main className="main">
          <div className="main-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
