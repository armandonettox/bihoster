import { formatPersonName } from "../utils/personName";
import { useState, type FormEvent } from "react";
import * as workspacesApi from "../api/workspaces";
import { useAccess } from "../context/AccessContext";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { assetUrl, extractErrorMessage } from "../api/client";
import { useBranding } from "../context/BrandingContext";
import DefaultBrandLogo from "../components/DefaultBrandLogo";
import { customText, noticeScreenTexts } from "../utils/errorScreens";

export default function WorkspaceOnboarding() {
  const { settings } = useBranding();
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

  const canCreateCollection = useAccess().can("colecao.criar");
  // Textos da marca: o titulo padrao leva o nome da pessoa; a mensagem personalizada vale para quem nao pode criar coleção
  const texts = noticeScreenTexts("noAccess", settings);
  const title = customText(settings?.no_access_title) ?? `Bem-vindo, ${formatPersonName(user?.name ?? "")}`;

  return (
    <div className="auth-screen">
      <div className="auth-card card card-elevated" style={{ width: 400 }}>
        {settings?.logo_url ? (
          <img src={assetUrl(settings.logo_url)} alt="Logo" className="auth-logo" />
        ) : (
          <DefaultBrandLogo className="auth-logo" />
        )}
        <h1 className="auth-title">{title}</h1>

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
          <p className="auth-subtitle">{texts.message}</p>
        )}

        <button type="button" className="btn btn-ghost btn-sm" onClick={logout} style={{ marginTop: 4 }}>
          {texts.button}
        </button>
      </div>
    </div>
  );
}
