import { useEffect, useState } from "react";
import * as workspacesApi from "../api/workspaces";
import type { AccessEntry, UserRole, Workspace } from "../api/workspaces";
import type { Group } from "../api/groups";
import AccessMatrixFields from "./AccessMatrixFields";
import CollectionIconPicker from "./CollectionIconPicker";
import Modal from "./Modal";
import { SkeletonList } from "./Skeleton";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

export default function EditCollectionModal({
  workspace,
  onSaved,
  onClose,
  manageAccess = false,
}: {
  workspace: Workspace;
  onSaved: () => void;
  onClose: () => void;
  /** Mostra o acesso de cada grupo à coleção e o grava junto com o resto. Só para quem é administrador da
   * plataforma (as rotas de acesso exigem isso); na Home, onde edita quem só cura a coleção, fica desligado. */
  manageAccess?: boolean;
}) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [icon, setIcon] = useState<string | null>(workspace.icon);
  const [color, setColor] = useState<string | null>(workspace.color);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Acesso dos grupos: null = ainda carregando. `accessValues` é o que está na tela; `accessEntries` é o que está
  // salvo, para saber o que mudou na hora de gravar.
  const [accessEntries, setAccessEntries] = useState<AccessEntry[] | null>(null);
  const [accessValues, setAccessValues] = useState<Record<number, UserRole | null>>({});
  const [accessLoadError, setAccessLoadError] = useState<string | null>(null);

  async function loadAccess() {
    try {
      const entries = await workspacesApi.getWorkspaceAccess(workspace.id);
      setAccessEntries(entries);
      setAccessValues(Object.fromEntries(entries.map((entry) => [entry.group_id, entry.role])));
      setAccessLoadError(null);
    } catch (err: any) {
      setAccessEntries([]);
      setAccessLoadError(
        err?.response?.status === 403
          ? "Só administradores da plataforma podem ver e alterar o acesso dos grupos."
          : extractErrorMessage(err) || "Não foi possível carregar o acesso dos grupos.",
      );
    }
  }

  useEffect(() => {
    if (manageAccess) void loadAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O administrador tem acesso total sempre e não aparece na lista
  const groups: Group[] = (accessEntries ?? []).map((entry) => ({
    id: entry.group_id,
    name: entry.group_name,
    is_default: entry.is_default,
    is_admin_group: entry.is_admin_group,
  }));

  function changedGroups(): { entry: AccessEntry; role: UserRole | null }[] {
    return (accessEntries ?? [])
      .filter((entry) => !entry.is_admin_group)
      .map((entry) => ({ entry, role: accessValues[entry.group_id] ?? null }))
      .filter(({ entry, role }) => role !== (entry.role ?? null));
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      try {
        await workspacesApi.updateWorkspace(workspace.id, { name, description: description || null, icon, color });
      } catch (err: any) {
        setSaveError(extractErrorMessage(err) || "Não foi possível salvar a coleção.");
        return;
      }

      // Só os grupos que mudaram. Se algum falhar, os outros já foram gravados: a janela fica aberta, mostra o que
      // deu errado e recarrega o acesso para a lista refletir o valor real do servidor.
      const changes = changedGroups();
      const results = await Promise.allSettled(
        changes.map(({ entry, role }) =>
          role === null
            ? workspacesApi.removeWorkspaceAccess(workspace.id, entry.group_id)
            : workspacesApi.setWorkspaceAccess(workspace.id, entry.group_id, role),
        ),
      );
      const failed = changes.filter((_, index) => results[index].status === "rejected").map(({ entry }) => entry.group_name);

      onSaved();
      if (failed.length === 0) {
        onClose();
        showToast("Coleção atualizada.");
        return;
      }
      setSaveError(`Os dados da coleção foram salvos, mas não foi possível alterar o acesso de: ${failed.join(", ")}.`);
      await loadAccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar coleção" onClose={onClose} wide={manageAccess}>
      <input
        className="input"
        aria-label="Nome da coleção"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ marginBottom: 10 }}
      />
      <textarea
        className="input"
        placeholder="Descrição (opcional)"
        aria-label="Descrição da coleção"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{ marginBottom: 10, resize: "vertical" }}
      />
      <CollectionIconPicker name={name} icon={icon} color={color} onChangeIcon={setIcon} onChangeColor={setColor} />

      {manageAccess &&
        (accessEntries === null ? (
          <SkeletonList count={2} />
        ) : accessLoadError ? (
          <p className="chat-hint" role="status">
            {accessLoadError}
          </p>
        ) : (
          <div className="edit-collection-access">
            <AccessMatrixFields
              groups={groups}
              values={accessValues}
              onChange={(groupId, role) => setAccessValues((current) => ({ ...current, [groupId]: role }))}
            />
          </div>
        ))}

      {saveError && (
        <p className="auth-error" role="alert">
          {saveError}
        </p>
      )}
      <div className="modal-actions-sticky">
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
