import { useCallback, useEffect, useState } from "react";
import * as workspacesApi from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
import { useAccess } from "../../context/AccessContext";
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
  // Editar e excluir tem cada um a sua permissao nesta colecao; o menu so aparece se a pessoa tiver alguma
  const access = useAccess();
  const canEdit = access.canIn("colecao.editar", workspace.id);
  const canDelete = access.canIn("colecao.excluir", workspace.id);

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

      {(canEdit || canDelete) && (
      <KebabMenu onClose={() => setConfirmingDelete(false)}>
        {(close) =>
          !confirmingDelete ? (
            <>
              {canEdit && (
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
              )}
              {canDelete && (
                <button
                  className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <MenuIcon name="delete" />
                  Excluir
                </button>
              )}
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
      )}

      {editing && <EditCollectionModal workspace={workspace} onSaved={onChanged} onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function CollectionsTab() {
  const { reload } = useWorkspace();
  // A lista e a de todas as colecoes (permissao "ver todas as colecoes"), e nao so as que a pessoa acessa
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  const load = useCallback(async () => {
    try {
      setWorkspaces(await workspacesApi.listAllWorkspaces());
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Uma colecao mudou: atualiza esta lista e a do resto do app (barra lateral e menus)
  async function handleChanged() {
    await load();
    await reload();
  }

  if (workspaces === null) {
    return <SkeletonList count={3} />;
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Coleções</h2>
      <p className="settings-section-desc">
        Aqui você vê todas as coleções e muda nome, descrição, ícone e cor. Quem pode ver e fazer o quê em cada uma, por
        grupo ou por pessoa, se escolhe em <strong>Gerenciar usuários</strong>.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {workspaces.map((w) => (
          <CollectionCard key={w.id} workspace={w} onChanged={handleChanged} />
        ))}
      </div>
    </div>
  );
}
