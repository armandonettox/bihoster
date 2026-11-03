import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as workspacesApi from "../api/workspaces";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import type { UserRole } from "../api/workspaces";
import { extractErrorMessage } from "../api/client";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import AccessMatrixFields from "./AccessMatrixFields";
import CollectionIconPicker from "./CollectionIconPicker";
import Modal from "./Modal";

// Modal de criar colecao. Guarda o proprio formulario: ao fechar, o componente sai da tela e o
// estado some junto, entao o proximo "Nova colecao" abre sempre limpo.
export default function NewCollectionModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { reloadAndSelect } = useWorkspace();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [access, setAccess] = useState<Record<number, UserRole | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    groupsApi
      .listGroups()
      .then((data) => {
        if (cancelled) return;
        setGroups(data);
        const defaults: Record<number, UserRole | null> = {};
        for (const g of data) {
          if (g.is_default) defaults[g.id] = "viewer";
        }
        setAccess(defaults);
      })
      .catch(() => {
        if (!cancelled) showToast("Nao foi possivel carregar os grupos para definir o acesso.", "error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const workspace = await workspacesApi.createWorkspace({
        name,
        description: description || null,
        icon,
        color,
      });

      for (const group of groups) {
        if (group.is_admin_group) continue;
        const role = access[group.id] || null;
        if (role) {
          await workspacesApi.setWorkspaceAccess(workspace.id, group.id, role);
        } else if (group.is_default) {
          await workspacesApi.removeWorkspaceAccess(workspace.id, group.id);
        }
      }

      await reloadAndSelect(workspace.id);
      onClose();
      navigate("/collection");
      showToast("Colecao criada.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel criar a colecao.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nova colecao" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <input
          className="input"
          autoFocus
          placeholder="Nome da colecao"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ marginBottom: 10 }}
        />
        <textarea
          className="input"
          placeholder="Descricao (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ marginBottom: 10, resize: "vertical" }}
        />
        <CollectionIconPicker name={name} icon={icon} color={color} onChangeIcon={setIcon} onChangeColor={setColor} />
        <AccessMatrixFields
          groups={groups}
          values={access}
          onChange={(groupId, value) => setAccess((prev) => ({ ...prev, [groupId]: value }))}
        />
        {error && <p className="auth-error">{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Criando..." : "Criar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
