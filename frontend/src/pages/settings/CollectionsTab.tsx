import { useState } from "react";
import * as workspacesApi from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
import { useWorkspace } from "../../context/WorkspaceContext";
import CollectionIcon from "../../components/CollectionIcon";
import EditCollectionModal from "../../components/EditCollectionModal";
import KebabMenu from "../../components/KebabMenu";
import MenuIcon from "../../components/MenuIcon";
import { SkeletonList } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";

function CollectionCard({ workspace, onChanged }: { workspace: Workspace; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await workspacesApi.deleteWorkspace(workspace.id);
      onChanged();
      showToast("Coleção excluída.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível excluir a coleção.", "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="card collection-row">
      <CollectionIcon name={workspace.name} icon={workspace.icon} color={workspace.color} size={24} />
      <div className="collection-row-text">
        <span className="collection-row-name">{workspace.name}</span>
        {workspace.description && <span className="collection-row-desc">{workspace.description}</span>}
      </div>

      <KebabMenu onClose={() => setConfirmingDelete(false)}>
        {(close) =>
          !confirmingDelete ? (
            <>
              <button
                className="kebab-menu-item kebab-menu-item-with-icon"
                onClick={() => {
                  setEditing(true);
                  close();
                }}
              >
                <MenuIcon name="edit" />
                Editar
              </button>
              <button
                className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                onClick={() => setConfirmingDelete(true)}
              >
                <MenuIcon name="delete" />
                Excluir
              </button>
            </>
          ) : (
            <>
              <button
                className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                disabled={deleting}
                onClick={() => {
                  close();
                  handleDelete();
                }}
              >
                <MenuIcon name="delete_forever" />
                {deleting ? "Excluindo..." : "Confirmar exclusão"}
              </button>
              <button className="kebab-menu-item kebab-menu-item-with-icon" onClick={() => setConfirmingDelete(false)}>
                <MenuIcon name="close" />
                Cancelar
              </button>
            </>
          )
        }
      </KebabMenu>

      {editing && <EditCollectionModal workspace={workspace} manageAccess onSaved={onChanged} onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function CollectionsTab() {
  const { workspaces, loading, reload } = useWorkspace();

  if (loading) {
    return <SkeletonList count={3} />;
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Coleções</h2>
      <p className="settings-section-desc">
        Cada coleção pode ter um nível de acesso diferente por grupo, como as permissões de coleção do Metabase (Sem
        acesso / Ver / Fazer curadoria). Para mudar o acesso de um grupo, abra o menu da coleção e escolha Editar.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {workspaces.map((w) => (
          <CollectionCard key={w.id} workspace={w} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}
