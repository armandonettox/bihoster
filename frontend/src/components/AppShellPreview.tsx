import type { CSSProperties } from "react";
import DefaultBrandLogo from "./DefaultBrandLogo";

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 360;
const DEFAULT_SCALE = 0.5;

export default function AppShellPreview({
  companyName,
  logoUrl,
  primaryColor,
  secondaryColor,
  scale = DEFAULT_SCALE,
  label = "Prévia",
}: {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Tamanho da prévia em relação à tela de verdade (0.5 = metade) */
  scale?: number;
  /** Texto acima da prévia; null esconde (quando a página já põe um título próprio) */
  label?: string | null;
}) {
  const cssVars = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
  } as CSSProperties;

  return (
    <div>
      {label && (
        <span style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginBottom: 8 }}>{label}</span>
      )}
      <div className="login-preview-frame" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
        <div
          className="login-preview-stage"
          style={{ ...cssVars, width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
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
                    <DefaultBrandLogo variant="icon" className="topbar-logo" />
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
