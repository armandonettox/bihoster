import { useState } from "react";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import Modal from "./Modal";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";

export default function AddGroupMemberModal({
  group,
  onAdded,
  onClose,
}: {
  group: Group;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSubmit() {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const result = await groupsApi.inviteGroupMember(group.id, email);
      onAdded();
      onClose();
      showToast(
        result.status === "added"
          ? "Membro adicionado ao grupo."
          : "Convite criado -- a pessoa entra no grupo automaticamente quando se cadastrar."
      );
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel adicionar ao grupo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Adicionar/convidar -- ${group.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <input
          className="input"
          type="email"
          placeholder="Email para adicionar ou convidar"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        {error && <p className="auth-error">{error}</p>}
        <div className="flex-row gap-sm">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? "Adicionando..." : "Adicionar/convidar"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
