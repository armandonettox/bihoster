import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { ToggleField } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";

/** A chave "Permitir saída de relatório com RLS" (desligada por padrão). Ligar pede confirmação: dados de quem tem
 * segurança por linha passam a sair por e-mail, arquivo e TV, sempre com a função de quem recebe. */
export default function GeneralRlsOutputModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = Boolean(settings.rls_output_enabled);
  const [enabled, setEnabled] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({ rls_output_enabled: enabled });
      await reload();
      showToast("Configurações salvas.");
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsEditModal
        title="Saída de relatório com RLS"
        description="Deixa relatórios com segurança por linha (RLS) saírem por e-mail, arquivo e Modo TV."
        dirty={enabled !== saved}
        saving={saving}
        error={error}
        onSave={() => (enabled && !saved ? setConfirming(true) : void save())}
        onClose={onClose}
      >
        <ToggleField
          id="general-rls-output"
          label="Permitir saída de relatório com RLS"
          hint="Desligado (padrão): relatório com RLS não sai por e-mail, arquivo nem TV. Ligado: cada e-mail vai com a função de quem recebe (só quem tem conta no portal e função mapeada), a exportação usa as funções de quem exporta e a TV usa uma função escolhida por quem monta a lista. Sem função mapeada, nada sai. O chat de IA continua fora."
          checked={enabled}
          onChange={setEnabled}
        />
      </SettingsEditModal>

      {confirming && (
        <ConfirmDialog
          title="Permitir saída de relatório com RLS?"
          message="Dados protegidos por segurança por linha poderão sair do portal por e-mail, arquivo e TV. Confirme só depois de mapear as funções de cada modelo em Relatórios: sem função mapeada nada sai, mas uma função errada mostra dados a quem não deveria. Cada saída fica na auditoria."
          confirmLabel="Permitir e salvar"
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
