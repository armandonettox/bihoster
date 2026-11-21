import type { CSSProperties } from "react";
import type { ErrorScreenKind, ErrorScreenTexts } from "../utils/errorScreens";
import BrandLogo from "./BrandLogo";
import ErrorScreen from "./ErrorScreen";

const STAGE_WIDTH = 720;
const STAGE_HEIGHT = 340;
const DEFAULT_SCALE = 0.5;

/** Prévia, em escala, de uma tela de erro com os textos e as cores da marca (mesmo desenho da tela de verdade).
 * As duas usam o logo da marca e, sem ele (ou se não carregar), o logo padrão, como acontece de verdade. */
export default function ErrorScreenPreview({
  kind,
  texts,
  logoUrl,
  primaryColor,
  secondaryColor,
  scale = DEFAULT_SCALE,
}: {
  kind: ErrorScreenKind;
  texts: ErrorScreenTexts;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Tamanho da prévia em relação à tela de verdade (0.5 = metade) */
  scale?: number;
}) {
  const cssVars = {
    "--color-primary": primaryColor,
    "--color-secondary": secondaryColor,
  } as CSSProperties;

  const logo = <BrandLogo logoUrl={logoUrl} className="error-page-logo" />;

  return (
    <div className="login-preview-frame" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
      <div
        className="login-preview-stage"
        style={{ ...cssVars, width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})`, background: "var(--color-bg)" }}
      >
        <ErrorScreen
          preview
          style={{ minHeight: 0, height: "100%" }}
          logo={logo}
          code={kind === "notFound" ? "404" : "Ops"}
          title={texts.title}
          message={texts.message}
          action={
            <button type="button" className="btn btn-primary" tabIndex={-1}>
              {texts.button}
            </button>
          }
        />
      </div>
    </div>
  );
}
