import { useState } from "react";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import CollectionIconPicker from "./CollectionIconPicker";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await workspacesApi.updateWorkspace(workspace.id, { name, description: description || null, icon, color });
      onSaved();
      onClose();
      showToast("Colecao atualizada.");
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Nao foi possivel salvar a colecao.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Editar colecao" onClose={onClose}>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
      <textarea
        className="input"
        placeholder="Descricao (opcional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{ marginBottom: 10, resize: "vertical" }}
      />
      <CollectionIconPicker name={name} icon={icon} color={color} onChangeIcon={setIcon} onChangeColor={setColor} />
      {saveError && <p className="auth-error">{saveError}</p>}
      <div style={{ display: "flex", gap: 8 }}>
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
