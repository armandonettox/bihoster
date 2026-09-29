import { Link } from "react-router-dom";
import { useBranding } from "../context/BrandingContext";
import { assetUrl } from "../api/client";
import DefaultBrandLogo from "../components/DefaultBrandLogo";

export default function NotFound() {
  const { settings } = useBranding();
  return (
    <div className="error-page">
      {settings?.logo_url ? (
        <img src={assetUrl(settings.logo_url)} alt="Logo" className="error-page-logo" />
      ) : (
        <DefaultBrandLogo className="error-page-logo" />
      )}
      <div className="error-page-code">404</div>
      <h1 className="error-page-title">Pagina nao encontrada</h1>
      <p className="error-page-desc">O endereco que voce tentou acessar nao existe ou foi removido.</p>
      <Link to="/" className="btn btn-primary">
        Voltar para o inicio
      </Link>
    </div>
  );
}
