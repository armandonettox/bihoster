import type { CSSProperties } from "react";
import type { ErrorScreenTexts, NoticeScreenKind } from "../utils/errorScreens";
import BrandLogo from "./BrandLogo";

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 400;
const DEFAULT_SCALE = 0.5;

/** Prévia, em escala, de uma tela de aviso (fora do horário ou sem acesso a coleção) com os textos e as cores da marca.
 * Mostra só o essencial: logo, título, mensagem e botão. O horário permitido, o formulário de pedir mais tempo e o de criar
 * coleção existem na tela de verdade e não são personalizáveis. */
export default function NoticeScreenPreview({
  kind,
  texts,
  logoUrl,
  primaryColor,
  secondaryColor,
  openingLine = false,
  scale = DEFAULT_SCALE,
}: {
  kind: NoticeScreenKind;
  texts: ErrorScreenTexts;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Fora do horário com mensagem personalizada: a linha de quando o acesso volta aparece abaixo dela */
  openingLine?: boolean;
  /** Tamanho da prévia em relação à tela de verdade (0.5 = metade) */
  scale?: number;
}) {
  const cssVars = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
  } as CSSProperties;

  return (
    <div className="login-preview-frame" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
      <div
        className="login-preview-stage"
        style={{ ...cssVars, width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})`, background: "var(--color-bg)" }}
      >
        <div className="auth-screen" style={{ height: "100%" }}>
          <div className="auth-card">
            <BrandLogo logoUrl={logoUrl} className="auth-logo" />
            <div className="auth-title">{texts.title}</div>
            <p className="auth-subtitle">{texts.message}</p>
            {kind === "outsideHours" && (
              <>
                {openingLine && <p className="auth-subtitle">O seu acesso volta em segunda-feira às 08:00.</p>}
                <div className="field">
                  <span>Seu horário de acesso</span>
                  <ul className="outside-hours-windows">
                    <li>Seg a Sex, 08:00 às 18:00</li>
                  </ul>
                </div>
                <button type="button" className="btn btn-primary" tabIndex={-1}>
                  {texts.button}
                </button>
              </>
            )}
            {kind === "noAccess" && (
              <button type="button" className="btn btn-ghost btn-sm" tabIndex={-1}>
                {texts.button}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
