import type { ReactNode } from "react";
import { assetUrl } from "../api/client";
import { useBranding } from "../context/BrandingContext";
import DefaultBrandLogo from "./DefaultBrandLogo";

/** Cabecalho unico das telas cheias (relatorio avulso, Apresentacao, Modo TV).
 *
 * - Esquerda: a logo do site. `title` e o nome do relatorio e so aparece escrito onde o conteudo troca
 *   sozinho (Apresentacao e TV); no relatorio avulso fica so como dica ao passar o mouse na logo.
 * - Meio: `actions`, a faixa reservada para as funcoes que vem por ai (assinatura, comentarios,
 *   alertas). Vazia, nao ocupa espaco nem mostra nada.
 * - Direita: `controls` (ex: setas da Apresentacao) e o botao Sair, quando ha como sair. */
export default function FullscreenHeader({
  title,
  showTitle = false,
  actions,
  controls,
  onExit,
}: {
  /** Nome do relatorio: dica da logo e, com `showTitle`, texto visivel */
  title: string;
  showTitle?: boolean;
  actions?: ReactNode;
  controls?: ReactNode;
  /** Sem isso nao ha botao Sair (a pagina /tv, aberta numa aba propria, nao tem pra onde voltar) */
  onExit?: () => void;
}) {
  const { settings } = useBranding();
  const brandName = settings?.company_name || "BIHoster";

  return (
    <header className="fullscreen-view-header">
      <div className="fullscreen-header-brand" title={title}>
        {settings?.logo_url ? (
          <img src={assetUrl(settings.logo_url)} alt={brandName} className="fullscreen-header-logo" />
        ) : (
          <DefaultBrandLogo variant="full" className="fullscreen-header-logo" />
        )}
        {showTitle && <span className="fullscreen-header-title">{title}</span>}
      </div>

      {actions && (
        <div className="fullscreen-header-actions" role="toolbar" aria-label="Acoes do relatorio">
          {actions}
        </div>
      )}

      <div className="fullscreen-header-end">
        {controls}
        {onExit && (
          <button
            type="button"
            className="fullscreen-exit"
            onClick={onExit}
            title="Sair da tela cheia (Esc)"
            aria-label="Sair da tela cheia (Esc)"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
            <span>Sair</span>
            <kbd aria-hidden="true">Esc</kbd>
          </button>
        )}
      </div>
    </header>
  );
}
