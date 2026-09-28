import { useState } from "react";
import * as workspacesApi from "../../api/workspaces";
import type { AccessEntry, UserRole, Workspace } from "../../api/workspaces";
import { useWorkspace } from "../../context/WorkspaceContext";
import CollectionIcon from "../../components/CollectionIcon";
import CollectionIconPicker from "../../components/CollectionIconPicker";
import { ACCESS_OPTIONS } from "../../components/AccessMatrixFields";
import KebabMenu from "../../components/KebabMenu";
import Modal from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";

function CollectionCard({ workspace, onChanged }: { workspace: Workspace; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [access, setAccess] = useState<AccessEntry[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(false);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [icon, setIcon] = useState<string | null>(workspace.icon);
  const [color, setColor] = useState<string | null>(workspace.color);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  async function loadAccess() {
    setLoadingAccess(true);
    try {
      setAccess(await workspacesApi.getWorkspaceAccess(workspace.id));
    } finally {
      setLoadingAccess(false);
    }
  }

  async function handleExpand() {
    if (!expanded) await loadAccess();
    setExpanded(!expanded);
  }

  async function handleAccessChange(groupId: number, value: string) {
    if (value === "none") {
      await workspacesApi.removeWorkspaceAccess(workspace.id, groupId);
    } else {
      await workspacesApi.setWorkspaceAccess(workspace.id, groupId, value as UserRole);
    }
    await loadAccess();
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await workspacesApi.updateWorkspace(workspace.id, {
        name,
        description: description || null,
        icon,
        color,
      });
      setEditing(false);
      onChanged();
      showToast("Colecao atualizada.");
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Nao foi possivel salvar a colecao.");
    } finally {
      setSaving(false);
    }
  }

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

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="settings-group-toggle" onClick={handleExpand} style={{ flex: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{expanded ? "▾" : "▸"}</span>
            <CollectionIcon name={workspace.name} icon={workspace.icon} color={workspace.color} size={24} />
            {workspace.name}
          </span>
        </button>
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
      </div>

      {editing && (
        <Modal title="Editar colecao" onClose={() => setEditing(false)}>
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
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-border)" }}>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 16px" }}>
            {workspace.description || "Sem descricao."}
          </p>

          {loadingAccess ? (
            <SkeletonList count={2} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Acesso a colecao</th>
                </tr>
              </thead>
              <tbody>
                {access
                  .filter((entry) => !entry.is_admin_group)
                  .map((entry) => (
                    <tr key={entry.group_id}>
                      <td>
                        {entry.group_name} {entry.is_default && <span className="badge">padrao</span>}
                      </td>
                      <td>
                        <select
                          className="input"
                          style={{ width: 160, padding: "6px 8px" }}
                          value={entry.role || "none"}
                          onChange={(e) => handleAccessChange(entry.group_id, e.target.value)}
                        >
                          {ACCESS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
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
        Cada colecao pode ter um nivel de acesso diferente por grupo -- igual permissoes de colecao
        no Metabase (Sem acesso / Ver / Fazer curadoria).
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {workspaces.map((w) => (
          <CollectionCard key={w.id} workspace={w} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}
