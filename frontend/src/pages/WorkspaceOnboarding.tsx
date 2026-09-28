import { useState, type FormEvent } from "react";
import * as workspacesApi from "../api/workspaces";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { extractErrorMessage } from "../api/client";

export default function WorkspaceOnboarding() {
  const { user, logout } = useAuth();
  const { reload } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await workspacesApi.createWorkspace({ name });
      await reload();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel criar a colecao.");
    } finally {
      setLoading(false);
    }
  }

  const canCreateCollection = !!user?.is_platform_admin;

  return (
    <div className="auth-screen">
      <div className="auth-card card card-elevated" style={{ width: 400 }}>
        <div className="auth-badge">PB</div>
        <h1 className="auth-title">Bem-vindo, {user?.name}</h1>

        {canCreateCollection ? (
          <form onSubmit={handleSubmit}>
            <p className="auth-subtitle">Voce ainda nao tem acesso a nenhuma colecao. Crie uma nova para comecar.</p>
            <label className="field">
              Nome da colecao
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Minha Empresa"
                required
                autoFocus
              />
            </label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? "Criando..." : "Criar colecao"}
            </button>
          </form>
        ) : (
          <p className="auth-subtitle">
            Voce ainda nao tem acesso a nenhuma colecao. Peca para um administrador te adicionar a um
            grupo com acesso -- so quem esta no grupo Administradores pode criar colecoes.
          </p>
        )}

        <button type="button" className="btn btn-ghost btn-sm" onClick={logout} style={{ marginTop: 4 }}>
          Sair
        </button>
      </div>
    </div>
  );
}
