import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../api/auth";
import { useBranding } from "../context/BrandingContext";
import { assetUrl, extractErrorMessage } from "../api/client";
import AuthLayout from "../components/AuthLayout";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { settings } = useBranding();
  const navigate = useNavigate();
  const registrationDisabled = settings != null && !settings.allow_registration;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(name, email, password);
      navigate("/login");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel criar a conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      {settings?.logo_url ? (
        <img src={assetUrl(settings.logo_url)} alt="Logo" className="auth-logo" />
      ) : (
        <div className="auth-badge">PB</div>
      )}
      <h1 className="auth-title">Criar conta</h1>
      <p className="auth-subtitle">Comece a hospedar seus relatorios</p>

      {registrationDisabled ? (
        <p className="auth-error">Criacao de conta esta desabilitada nesta instancia.</p>
      ) : (
      <form onSubmit={handleSubmit} className="auth-form">
        <label className="field">
          Nome
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" required />
        </label>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            required
          />
        </label>
        <label className="field">
          Senha
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimo 8 caracteres"
            minLength={8}
            required
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
          {loading ? "Criando..." : "Criar conta"}
        </button>
      </form>
      )}

      <p className="auth-footer">
        Ja tem conta? <Link to="/login">Entrar</Link>
      </p>
    </AuthLayout>
  );
}
