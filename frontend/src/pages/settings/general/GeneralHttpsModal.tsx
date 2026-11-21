import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { ToggleField } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";

/** O redirecionamento de http para https. Ligar pede confirmação: com o site ainda sem certificado, o portal pode
 * ficar fora do ar. */
export default function GeneralHttpsModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = settings.force_https || false;
  const [forceHttps, setForceHttps] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({ force_https: forceHttps });
      await reload();
      showToast("Configurações salvas.");
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    // Ligar o HTTPS com o site ainda sem certificado pode deixar o portal fora do ar: pede confirmação antes
    if (forceHttps && !saved) {
      setConfirming(true);
      return;
    }
    void save();
  }

  return (
    <>
      <SettingsEditModal
        title="Acesso seguro (HTTPS)"
        description="Leva quem abrir o portal por http para https."
        dirty={forceHttps !== saved}
        saving={saving}
        error={error}
        onSave={handleSave}
        onClose={onClose}
      >
        <ToggleField
          id="general-force-https"
          label="Redirecionar para HTTPS"
          hint="Só funciona quando o site está acessível por um domínio real (não afeta localhost)."
          checked={forceHttps}
          onChange={setForceHttps}
        />
      </SettingsEditModal>

      {confirming && (
        <ConfirmDialog
          title="Ligar o redirecionamento para HTTPS?"
          message="Depois de salvar, quem abrir o portal por http será levado para https. Se o domínio ainda não tiver certificado, ou se o site não abrir por https, o acesso ao portal pode ficar fora do ar. Confirme só se você já consegue abrir o site por https."
          confirmLabel="Ligar e salvar"
          onConfirm={() => {
            setConfirming(false);
            void save();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
