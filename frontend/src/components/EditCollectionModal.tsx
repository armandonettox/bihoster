import { useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { descendantIds } from "../utils/folders";
import ParentFolderSelect from "./ParentFolderSelect";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import CollectionIconPicker from "./CollectionIconPicker";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

/** Editar os dados de uma coleção: nome, descrição, ícone e cor. Quem pode ver e fazer o quê nela (por grupo ou por
 * pessoa) se escolhe em Gerenciar usuários, não aqui. */
export default function EditCollectionModal({
  workspace,
  onSaved,
  onClose,
}: {
  workspace: Workspace;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [icon, setIcon] = useState<string | null>(workspace.icon);
  const [color, setColor] = useState<string | null>(workspace.color);
  const { workspaces } = useWorkspace();
  const [parentId, setParentId] = useState<number | null>(workspace.parent_id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const moved = parentId !== (workspace.parent_id ?? null);
      await workspacesApi.updateWorkspace(workspace.id, {
        name,
        description: description || null,
        icon,
        color,
        ...(moved ? { parent_id: parentId } : {}),
      });
      onSaved();
      onClose();
      showToast("Coleção atualizada.");
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Não foi possível salvar a coleção.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar coleção" onClose={onClose}>
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
      <ParentFolderSelect
        workspaces={workspaces}
        value={parentId}
        onChange={setParentId}
        excludeIds={[workspace.id, ...descendantIds(workspaces, workspace.id)]}
      />

      <p className="chat-hint">
        Para escolher quem pode ver e fazer o quê nesta coleção, use <strong>Gerenciar usuários</strong>, no menu de módulos
        do canto superior.
      </p>

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
