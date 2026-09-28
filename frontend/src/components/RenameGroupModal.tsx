import { useState } from "react";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

export default function RenameGroupModal({
  group,
  onSaved,
  onClose,
}: {
  group: Group;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSave() {
    if (saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await groupsApi.updateGroup(group.id, name);
      onSaved();
      onClose();
      showToast("Grupo renomeado.");
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Nao foi possivel renomear o grupo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Renomear grupo" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          style={{ marginBottom: 10 }}
        />
        {saveError && <p className="auth-error">{saveError}</p>}
        <div className="flex-row gap-sm">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
