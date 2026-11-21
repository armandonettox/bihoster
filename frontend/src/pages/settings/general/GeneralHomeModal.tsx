import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import type { Workspace } from "../../../api/workspaces";
import { Field, ToggleField } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";

/** A coleção que abre primeiro e o atalho para quem só tem uma coleção */
export default function GeneralHomeModal({
  settings,
  workspaces,
  onClose,
}: {
  settings: AppSettings;
  workspaces: Workspace[];
  onClose: () => void;
}) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = {
    homeWorkspaceId: settings.default_workspace_id || ("" as number | ""),
    singleCollectionRedirect: settings.single_collection_redirect || false,
  };
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<number | "">(saved.homeWorkspaceId);
  const [singleCollectionRedirect, setSingleCollectionRedirect] = useState(saved.singleCollectionRedirect);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = homeWorkspaceId !== saved.homeWorkspaceId || singleCollectionRedirect !== saved.singleCollectionRedirect;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        default_workspace_id: homeWorkspaceId || null,
        single_collection_redirect: singleCollectionRedirect,
      });
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
    <SettingsEditModal
      title="Homepage"
      description="Coleção que os usuários veem primeiro ao entrar no sistema."
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <div className="settings-stack">
        <Field
          id="general-home-collection"
          label="Coleção"
          hint="Usuários sem acesso a essa coleção veem a tela padrão normalmente."
        >
          <select
            id="general-home-collection"
            className="input"
            value={homeWorkspaceId}
            aria-describedby="general-home-collection-hint"
            onChange={(e) => setHomeWorkspaceId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Nenhuma (tela padrão)</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>

        <ToggleField
          id="general-single-collection"
          label="Abrir direto na coleção única"
          hint="Quando ativado, usuários com acesso a uma única coleção entram direto nela, sem passar pela tela inicial."
          checked={singleCollectionRedirect}
          onChange={setSingleCollectionRedirect}
        />
      </div>
    </SettingsEditModal>
  );
}
