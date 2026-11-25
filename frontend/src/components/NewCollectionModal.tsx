import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as workspacesApi from "../api/workspaces";
import { extractErrorMessage } from "../api/client";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import CollectionIconPicker from "./CollectionIconPicker";
import Modal from "./Modal";
import ParentFolderSelect from "./ParentFolderSelect";

// Modal de criar colecao. Guarda o proprio formulario: ao fechar, o componente sai da tela e o
// estado some junto, entao o proximo "Nova colecao" abre sempre limpo.
export default function NewCollectionModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { reloadAndSelect, workspaces } = useWorkspace();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  // Por padrao toda colecao nova pode ser vista por todas as pessoas; desligado, ela nasce privada
  const [everyoneCanView, setEveryoneCanView] = useState(true);
  // Pasta onde a colecao fica (nenhuma = pasta de topo)
  const [parentId, setParentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        everyone_can_view: everyoneCanView,
        ...(parentId != null ? { parent_id: parentId } : {}),
      });

      await reloadAndSelect(workspace.id);
      onClose();
      navigate("/collection");
      showToast("Coleção criada.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível criar a coleção.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Nova coleção" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <input
          className="input"
          autoFocus
          placeholder="Nome da coleção"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{ marginBottom: 10 }}
        />
        <textarea
          className="input"
          placeholder="Descrição (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ marginBottom: 10, resize: "vertical" }}
        />
        <CollectionIconPicker name={name} icon={icon} color={color} onChangeIcon={setIcon} onChangeColor={setColor} />
        <ParentFolderSelect workspaces={workspaces} value={parentId} onChange={setParentId} />
        <label className="field-checkbox" style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0 4px" }}>
          <input type="checkbox" checked={everyoneCanView} onChange={(e) => setEveryoneCanView(e.target.checked)} />
          Todas as pessoas podem ver esta coleção
        </label>
        <p className="chat-hint" style={{ marginTop: 0 }}>
          Desmarque para criar uma coleção privada. Depois de criar, use <strong>Gerenciar usuários</strong> para dar acesso a
          grupos ou pessoas.
        </p>
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
