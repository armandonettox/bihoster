import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/auth";
import AuthLayout from "../components/AuthLayout";
import { extractErrorMessage } from "../api/client";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas nao coincidem.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <h1 className="auth-title">Link invalido</h1>
        <p className="auth-subtitle">Esse link de redefinicao de senha esta incompleto ou invalido.</p>
        <p className="auth-footer">
          <Link to="/login">Voltar para o login</Link>
        </p>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <h1 className="auth-title">Senha redefinida</h1>
        <p className="auth-subtitle">Sua senha foi atualizada. Voce ja pode entrar com ela.</p>
        <button className="btn btn-primary btn-block" onClick={() => navigate("/login")}>
          Ir para o login
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">Redefinir senha</h1>
      <p className="auth-subtitle">Escolha uma nova senha para sua conta</p>

      <form onSubmit={handleSubmit} className="auth-form">
        <label className="field">
          Nova senha
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
        <label className="field">
          Confirmar nova senha
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="********"
            required
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
          {loading ? "Salvando..." : "Redefinir senha"}
        </button>
      </form>
    </AuthLayout>
  );
}
