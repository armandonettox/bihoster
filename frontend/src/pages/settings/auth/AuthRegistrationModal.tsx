import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import { ToggleField } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";

/** Se novas pessoas podem criar conta sozinhas pela tela de login */
export default function AuthRegistrationModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = settings.allow_registration ?? true;
  const [allowRegistration, setAllowRegistration] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({ allow_registration: allowRegistration });
      await reload();
      showToast(allowRegistration ? "Criação de conta habilitada." : "Criação de conta desabilitada.");
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Criação de conta"
      description="Controla se novas pessoas podem se cadastrar sozinhas pela tela de login."
      dirty={allowRegistration !== saved}
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <ToggleField
        id="auth-allow-registration"
        label="Permitir criar conta"
        hint='Quando desabilitado, o link "Criar conta" some da tela de login e o cadastro direto passa a ser bloqueado.'
        checked={allowRegistration}
        onChange={setAllowRegistration}
      />
    </SettingsEditModal>
  );
}
