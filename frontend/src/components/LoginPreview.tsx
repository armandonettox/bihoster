import type { CSSProperties } from "react";
import type { LoginLayout } from "../api/settings";

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 440;
const SCALE = 0.5;

export default function LoginPreview({
  companyName,
  logoUrl,
  primaryColor,
  secondaryColor,
  layout,
  loginImageUrl,
}: {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  layout: LoginLayout;
  loginImageUrl: string | null;
}) {
  const cssVars = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
  } as CSSProperties;

  const card = (
    <div className={layout === "split" ? "auth-card auth-card-flat" : "auth-card card card-elevated"}>
      {logoUrl ? (
        <img src={logoUrl} alt="Logo" className="auth-logo" />
      ) : (
        <div className="auth-badge">{companyName.slice(0, 2).toUpperCase()}</div>
      )}
      <h1 className="auth-title">Entrar no {companyName}</h1>
      <p className="auth-subtitle">Acesse seus relatorios e workspaces</p>

      <div className="auth-form">
        <label className="field">
          Email
          <input className="input" value="voce@empresa.com" readOnly tabIndex={-1} />
        </label>
        <label className="field">
          Senha
          <input className="input" type="password" value="********" readOnly tabIndex={-1} />
        </label>
        <button className="btn btn-primary btn-block" type="button" tabIndex={-1}>
          Entrar
        </button>
      </div>

      <p className="auth-footer">Nao tem conta? Criar conta</p>
    </div>
  );

  return (
    <div>
      <span style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginBottom: 8 }}>
        Previa da tela de login
      </span>
      <div
        className="login-preview-frame"
        style={{ width: STAGE_WIDTH * SCALE, height: STAGE_HEIGHT * SCALE }}
      >
        <div
          className="login-preview-stage"
          style={{ ...cssVars, width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${SCALE})` }}
        >
          {layout === "split" ? (
            <div className="auth-split" style={{ height: "100%" }}>
              <div className="auth-split-left">{card}</div>
              <div
                className="auth-split-right"
                style={loginImageUrl ? { backgroundImage: `url(${loginImageUrl})` } : undefined}
              >
                {!loginImageUrl && <div className="auth-split-right-fallback" />}
              </div>
            </div>
          ) : (
            <div className="auth-screen" style={{ height: "100%" }}>
              {card}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
