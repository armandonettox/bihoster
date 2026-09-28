import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="error-page">
      <div className="error-page-code">404</div>
      <h1 className="error-page-title">Pagina nao encontrada</h1>
      <p className="error-page-desc">O endereco que voce tentou acessar nao existe ou foi removido.</p>
      <Link to="/" className="btn btn-primary">
        Voltar para o inicio
      </Link>
    </div>
  );
}
