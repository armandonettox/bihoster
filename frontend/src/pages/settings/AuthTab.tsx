import { useEffect, useState, type FormEvent } from "react";
import * as settingsApi from "../../api/settings";
import { useBranding } from "../../context/BrandingContext";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";

export default function AuthTab() {
  const { settings, reload } = useBranding();
  const { showToast } = useToast();

  const [allowRegistration, setAllowRegistration] = useState(settings?.allow_registration ?? true);
  const [savingRegistration, setSavingRegistration] = useState(false);

  const [googleEnabled, setGoogleEnabled] = useState(settings?.google_oauth_enabled ?? false);
  const [googleClientId, setGoogleClientId] = useState(settings?.google_client_id || "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleAllowedDomains, setGoogleAllowedDomains] = useState(settings?.google_allowed_domains || "");
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setAllowRegistration(settings.allow_registration);
    setGoogleEnabled(settings.google_oauth_enabled);
    setGoogleClientId(settings.google_client_id || "");
    setGoogleAllowedDomains(settings.google_allowed_domains || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings === null]);

  async function handleToggleRegistration(checked: boolean) {
    setAllowRegistration(checked);
    setSavingRegistration(true);
    try {
      await settingsApi.updateSettings({ allow_registration: checked });
      await reload();
      showToast(checked ? "Criacao de conta habilitada." : "Criacao de conta desabilitada.");
    } catch (err: any) {
      setAllowRegistration(!checked);
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar.", "error");
    } finally {
      setSavingRegistration(false);
    }
  }

  async function handleSaveGoogle(event: FormEvent) {
    event.preventDefault();
    setGoogleError(null);
    setSavingGoogle(true);
    try {
      await settingsApi.updateSettings({
        google_oauth_enabled: googleEnabled,
        google_client_id: googleClientId || null,
        google_allowed_domains: googleAllowedDomains || null,
        ...(googleClientSecret ? { google_client_secret: googleClientSecret } : {}),
      });
      await reload();
      setGoogleClientSecret("");
      showToast("Configuracoes de login com Google salvas.");
    } catch (err: any) {
      setGoogleError(extractErrorMessage(err) || "Nao foi possivel salvar.");
    } finally {
      setSavingGoogle(false);
    }
  }

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Criacao de conta</h2>
        <p className="settings-section-desc">
          Controla se novas pessoas podem se cadastrar sozinhas pela tela de login.
        </p>

        <label className="field">
          Permitir criar conta
          <div className="toggle-field" style={{ marginTop: 4 }}>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={allowRegistration}
                disabled={savingRegistration}
                onChange={(e) => handleToggleRegistration(e.target.checked)}
              />
              <span className="toggle-switch-track" />
            </label>
            <span style={{ fontWeight: 400, fontSize: 13, color: "var(--color-text-muted)" }}>
              {allowRegistration ? "Habilitado" : "Desabilitado"}
            </span>
          </div>
          <span style={{ fontWeight: 400, fontSize: 12 }}>
            Quando desabilitado, o link "Criar conta" some da tela de login e o cadastro direto passa a ser bloqueado.
          </span>
        </label>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Login com Google</h2>
        <p className="settings-section-desc">
          Permite entrar com uma conta Google -- a verificacao em duas etapas, quando ativada na conta
          Google da pessoa, e cuidada pelo proprio Google no momento do login.
        </p>

        <form onSubmit={handleSaveGoogle}>
          <label className="field" style={{ marginBottom: 16 }}>
            Habilitar login com Google
            <div className="toggle-field" style={{ marginTop: 4 }}>
              <label className="toggle-switch">
                <input type="checkbox" checked={googleEnabled} onChange={(e) => setGoogleEnabled(e.target.checked)} />
                <span className="toggle-switch-track" />
              </label>
              <span style={{ fontWeight: 400, fontSize: 13, color: "var(--color-text-muted)" }}>
                {googleEnabled ? "Habilitado" : "Desabilitado"}
              </span>
            </div>
          </label>

          <div className="settings-grid">
            <label className="field">
              Client ID
              <input
                className="input"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder="xxxxxxxx.apps.googleusercontent.com"
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Do Google Cloud Console, tela de credenciais OAuth 2.0.
              </span>
            </label>
            <label className="field">
              Client secret
              <input
                className="input"
                type="password"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder={settings?.google_client_secret_configured ? "Ja configurado -- deixe em branco para manter" : ""}
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Nunca e exibido depois de salvo. Deixe em branco para manter o atual.
              </span>
            </label>
          </div>

          <label className="field" style={{ marginTop: 16 }}>
            Dominios permitidos
            <input
              className="input"
              value={googleAllowedDomains}
              onChange={(e) => setGoogleAllowedDomains(e.target.value)}
              placeholder="empresa.com, empresa.com.br"
            />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              Opcional. Lista separada por virgula -- so contas Google com um desses dominios de email
              podem entrar. Deixe em branco para permitir qualquer conta Google.
            </span>
          </label>

          {googleError && <p className="auth-error">{googleError}</p>}
          <button type="submit" className="btn btn-primary" disabled={savingGoogle} style={{ marginTop: 16 }}>
            {savingGoogle ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>
    </div>
  );
}
