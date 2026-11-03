import { useState } from "react";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";
import CollectionIcon from "./CollectionIcon";
import EditCollectionModal from "./EditCollectionModal";
import KebabMenu from "./KebabMenu";
import type { ViewMode } from "./ViewModeToggle";

export default function CollectionCard({
  workspace,
  viewMode,
  onOpen,
  onChanged,
}: {
  workspace: Workspace;
  viewMode: ViewMode;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canManage = workspace.role === "admin";
  const { showToast } = useToast();

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await workspacesApi.deleteWorkspace(workspace.id);
      onChanged();
      showToast("Colecao excluida.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir a colecao.", "error");
    } finally {
      setDeleting(false);
    }
  }

  const iconSize = viewMode === "icon" ? 32 : 22;

  return (
    <>
      {editing && <EditCollectionModal workspace={workspace} onSaved={onChanged} onClose={() => setEditing(false)} />}
      <div
        className={`card ${viewMode === "icon" ? "home-collection-item" : "home-page-item"}`}
        style={{ cursor: "pointer" }}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
      >
      {viewMode === "icon" && (
        <CollectionIcon name={workspace.name} icon={workspace.icon} color={workspace.color} size={iconSize} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{workspace.name}</div>
      </div>
      {canManage && (
        <KebabMenu onClose={() => setConfirmingDelete(false)}>
          {(close) =>
            !confirmingDelete ? (
              <>
                <button
                  className="kebab-menu-item"
                  onClick={() => {
                    setEditing(true);
                    close();
                  }}
                >
                  Editar
                </button>
                <button className="kebab-menu-item kebab-menu-item-danger" onClick={() => setConfirmingDelete(true)}>
                  Excluir
                </button>
              </>
            ) : (
              <>
                <button
                  className="kebab-menu-item kebab-menu-item-danger"
                  disabled={deleting}
                  onClick={() => {
                    close();
                    handleDelete();
                  }}
                >
                  {deleting ? "Excluindo..." : "Confirmar exclusao"}
                </button>
                <button className="kebab-menu-item" onClick={() => setConfirmingDelete(false)}>
                  Cancelar
                </button>
              </>
            )
          }
        </KebabMenu>
      )}
      </div>
    </>
  );
}
