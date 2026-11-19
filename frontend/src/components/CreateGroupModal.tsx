import { useState } from "react";
import * as groupsApi from "../api/groups";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

/** Janela de criar um grupo: só o nome. As permissões e as pessoas se escolhem depois, na janela do grupo. */
export default function CreateGroupModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleCreate() {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await groupsApi.createGroup(name);
      onCreated();
      onClose();
      showToast("Grupo criado.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel criar o grupo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar grupo" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <input
          className="input"
          placeholder="Nome do grupo"
          aria-label="Nome do novo grupo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          style={{ marginBottom: 10 }}
        />
        <p className="chat-hint" style={{ marginTop: 0 }}>
          Depois de criar, abra o menu do grupo para escolher as permissões e quem faz parte dele.
        </p>
        {error && <p className="auth-error">{error}</p>}
        <div className="flex-row gap-sm">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? "Criando..." : "Criar grupo"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
