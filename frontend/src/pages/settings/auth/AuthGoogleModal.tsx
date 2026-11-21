import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import { Field, ToggleField } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";

/** O login com a conta Google: liga e desliga, as credenciais e os domínios aceitos. O client secret nunca volta do
 * servidor: em branco mantém o atual, e só um texto novo o troca. */
export default function AuthGoogleModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = {
    enabled: settings.google_oauth_enabled ?? false,
    clientId: settings.google_client_id || "",
    domains: settings.google_allowed_domains || "",
  };
  const [enabled, setEnabled] = useState(saved.enabled);
  const [clientId, setClientId] = useState(saved.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [domains, setDomains] = useState(saved.domains);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    enabled !== saved.enabled || clientId !== saved.clientId || domains !== saved.domains || clientSecret !== "";

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        google_oauth_enabled: enabled,
        google_client_id: clientId || null,
        google_allowed_domains: domains || null,
        ...(clientSecret ? { google_client_secret: clientSecret } : {}),
      });
      await reload();
      showToast("Configurações de login com Google salvas.");
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Login com Google"
      description="Permite entrar com uma conta Google. A verificação em duas etapas, quando ativada na conta Google da pessoa, é cuidada pelo próprio Google no momento do login."
      dirty={dirty}
      saving={saving}
      error={error}
      wide
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <ToggleField
        id="auth-google-enabled"
        label="Habilitar login com Google"
        hint="Com o login desligado, o botão do Google some da tela de login."
        checked={enabled}
        onChange={setEnabled}
      />

      <div className="settings-grid settings-grid-two">
        <Field id="auth-google-client-id" label="Client ID" hint="Do Google Cloud Console, tela de credenciais OAuth 2.0.">
          <input
            id="auth-google-client-id"
            className="input"
            value={clientId}
            aria-describedby="auth-google-client-id-hint"
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxxxxxxx.apps.googleusercontent.com"
          />
        </Field>
        <Field
          id="auth-google-client-secret"
          label="Client secret"
          hint="Nunca é exibido depois de salvo. Deixe em branco para manter o atual."
        >
          <input
            id="auth-google-client-secret"
            className="input"
            type="password"
            autoComplete="new-password"
            value={clientSecret}
            aria-describedby="auth-google-client-secret-hint"
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={settings.google_client_secret_configured ? "Já configurado: deixe em branco para manter" : ""}
          />
        </Field>
      </div>

      <Field
        id="auth-google-domains"
        label="Domínios permitidos"
        hint="Opcional. Lista separada por vírgula: só contas Google com um desses domínios de e-mail podem entrar. Deixe em branco para permitir qualquer conta Google."
        className="field-spaced"
      >
        <input
          id="auth-google-domains"
          className="input"
          value={domains}
          aria-describedby="auth-google-domains-hint"
          onChange={(e) => setDomains(e.target.value)}
          placeholder="empresa.com, empresa.com.br"
        />
      </Field>
    </SettingsEditModal>
  );
}
