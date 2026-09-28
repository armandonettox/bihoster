import type { CSSProperties } from "react";

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 360;
const SCALE = 0.5;

export default function AppShellPreview({
  companyName,
  logoUrl,
  primaryColor,
  secondaryColor,
}: {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}) {
  const cssVars = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
  } as CSSProperties;

  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginBottom: 8 }}>
        Previa
      </span>
      <div className="login-preview-frame" style={{ width: STAGE_WIDTH * SCALE, height: STAGE_HEIGHT * SCALE }}>
        <div
          className="login-preview-stage"
          style={{ ...cssVars, width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${SCALE})` }}
        >
          <div className="app-shell" style={{ height: "100%" }}>
            <header className="topbar">
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <button type="button" className="btn btn-ghost sidebar-toggle-btn" tabIndex={-1}>
                  <span className="hamburger-icon">
                    <span />
                    <span />
                    <span />
                  </span>
                </button>
                <div className="topbar-brand">
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="topbar-logo" />
                  ) : (
                    <div className="topbar-logo-fallback">{companyName.slice(0, 2).toUpperCase()}</div>
                  )}
                  <span className="topbar-brand-name">{companyName}</span>
                </div>
                <div className="input" style={{ width: 180, color: "var(--color-text-muted)", fontSize: 13 }}>
                  Buscar paginas...
                </div>
              </div>
              <div className="user-chip">
                <div className="user-avatar">AR</div>
              </div>
            </header>

            <div className="app-body">
              <aside className="sidebar">
                <div className="sidebar-scroll" style={{ marginTop: 0 }}>
                  <div className="sidebar-section">
                    <div className="sidebar-home-link sidebar-home-link-active">
                      <span className="sidebar-home-icon">&#8962;</span>
                      Inicio
                    </div>
                  </div>
                  <div className="sidebar-section">
                    <p className="sidebar-section-title">Colecoes</p>
                    <div className="tree-item tree-item-active">
                      <span className="tree-item-link">Colecao ativa</span>
                    </div>
                    <div className="tree-item">
                      <span className="tree-item-link">Outra colecao</span>
                    </div>
                  </div>
                </div>
              </aside>
              <main className="main">
                <div className="main-content">
                  <button type="button" className="btn btn-primary" tabIndex={-1} style={{ marginRight: 8 }}>
                    Botao primario
                  </button>
                  <span className="badge">Destaque</span>
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
