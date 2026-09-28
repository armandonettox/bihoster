import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as homeApi from "../api/home";
import * as favoritesApi from "../api/favorites";
import * as workspacesApi from "../api/workspaces";
import * as groupsApi from "../api/groups";
import type { HomeCollectionEntry } from "../api/home";
import type { Report } from "../api/reports";
import type { Group } from "../api/groups";
import type { UserRole } from "../api/workspaces";
import { useWorkspace } from "../context/WorkspaceContext";
import type { Workspace } from "../api/workspaces";
import CollectionIcon from "../components/CollectionIcon";
import CollectionIconPicker from "../components/CollectionIconPicker";
import AccessMatrixFields from "../components/AccessMatrixFields";
import KebabMenu from "../components/KebabMenu";
import Modal from "../components/Modal";
import EditCollectionModal from "../components/EditCollectionModal";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../context/ToastContext";
import { safeStorage } from "../utils/safeStorage";
import { extractErrorMessage } from "../api/client";

type Tab = "collections" | "recommended" | "recent" | "favorites";
type ViewMode = "list" | "icon";
const HOME_VIEW_MODE_KEY = "home_view_mode";

const TABS: { key: Tab; label: string }[] = [
  { key: "collections", label: "Colecoes" },
  { key: "recommended", label: "Recomendado" },
  { key: "recent", label: "Recentes" },
  { key: "favorites", label: "Favoritos" },
];

function ViewModeToggle({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      <button
        className={`btn btn-ghost btn-sm ${viewMode === "list" ? "btn-ghost-active" : ""}`}
        onClick={() => onChange("list")}
        title="Ver como lista"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          view_list
        </span>
      </button>
      <button
        className={`btn btn-ghost btn-sm ${viewMode === "icon" ? "btn-ghost-active" : ""}`}
        onClick={() => onChange("icon")}
        title="Ver como icones"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          grid_view
        </span>
      </button>
    </div>
  );
}

function CollectionEntryList({
  entries,
  emptyMessage,
  viewMode,
  onOpen,
}: {
  entries: HomeCollectionEntry[];
  emptyMessage: string;
  viewMode: ViewMode;
  onOpen: (entry: HomeCollectionEntry) => void;
}) {
  if (entries.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{emptyMessage}</p>;
  }

  if (viewMode === "icon") {
    return (
      <div key="icon" className="settings-grid view-mode-fade">
        {entries.map((entry) => (
          <button key={entry.id} className="card home-collection-item" onClick={() => onOpen(entry)}>
            <CollectionIcon name={entry.name} icon={entry.icon} color={entry.color} size={32} />
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{entry.name}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((entry) => (
        <button key={entry.id} className="card home-page-item" onClick={() => onOpen(entry)}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span className="home-page-item-dot" />
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.name}
            </span>
          </span>
          <span className="home-page-item-arrow">&rsaquo;</span>
        </button>
      ))}
    </div>
  );
}

function FavoriteReportList({
  reports,
  emptyMessage,
  workspaces,
  viewMode,
  onOpen,
}: {
  reports: Report[];
  emptyMessage: string;
  workspaces: Workspace[];
  viewMode: ViewMode;
  onOpen: (report: Report) => void;
}) {
  if (reports.length === 0) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>{emptyMessage}</p>;
  }

  if (viewMode === "icon") {
    return (
      <div key="icon" className="settings-grid view-mode-fade">
        {reports.map((report) => {
          const workspace = workspaces.find((w) => w.id === report.collection_id);
          return (
            <button key={report.id} className="card home-collection-item" onClick={() => onOpen(report)}>
              <CollectionIcon name={report.name} icon={workspace?.icon} color={workspace?.color} size={32} />
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 700 }}>{report.name}</div>
                {workspace && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{workspace.name}</div>}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div key="list" className="view-mode-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {reports.map((report) => {
        const workspace = workspaces.find((w) => w.id === report.collection_id);
        return (
          <button key={report.id} className="card home-page-item" onClick={() => onOpen(report)}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span className="home-page-item-dot" />
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {report.name}
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span className="badge">{workspace?.name || ""}</span>
              <span className="home-page-item-arrow">&rsaquo;</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CollectionCard({
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

export default function HomeDashboard() {
  const [tab, setTab] = useState<Tab>("collections");
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (safeStorage.getItem(HOME_VIEW_MODE_KEY) as ViewMode) || "icon"
  );
  const { workspaces, selectWorkspace, currentWorkspace, reloadAndSelect } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [recommended, setRecommended] = useState<HomeCollectionEntry[]>([]);
  const [recent, setRecent] = useState<HomeCollectionEntry[]>([]);
  const [favorites, setFavorites] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newColor, setNewColor] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newAccess, setNewAccess] = useState<Record<number, UserRole | null>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const isAnyAdmin = workspaces.some((w) => w.role === "admin");
  const { showToast } = useToast();

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    safeStorage.setItem(HOME_VIEW_MODE_KEY, mode);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([homeApi.listRecommendedCollections(), homeApi.listRecentCollections(), favoritesApi.listFavorites()])
      .then(([rec, recentList, favs]) => {
        if (cancelled) return;
        setRecommended(rec);
        setRecent(recentList);
        setFavorites(favs);
      })
      .catch(() => {
        if (!cancelled) showToast("Nao foi possivel carregar os dados da pagina inicial.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchParams.get("new") === "collection") {
      setTab("collections");
      setCreating(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (creating && groups.length === 0) {
      groupsApi.listGroups().then((data) => {
        setGroups(data);
        const defaults: Record<number, UserRole | null> = {};
        for (const g of data) {
          if (g.is_default) defaults[g.id] = "viewer";
        }
        setNewAccess(defaults);
      });
    }
  }, [creating, groups.length]);

  function openCollection(entry: { id: number }) {
    if (currentWorkspace?.id !== entry.id) {
      selectWorkspace(entry.id);
    }
    navigate("/collection");
  }

  function openReportCollection(report: Report) {
    if (currentWorkspace?.id !== report.collection_id) {
      selectWorkspace(report.collection_id);
    }
    navigate("/collection");
  }

  async function handleCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    if (creatingWorkspace) return;
    setCreateError(null);
    setCreatingWorkspace(true);
    try {
      const workspace = await workspacesApi.createWorkspace({
        name: newName,
        description: newDescription || null,
        icon: newIcon,
        color: newColor,
      });

      for (const group of groups) {
        if (group.is_admin_group) continue;
        const role = newAccess[group.id] || null;
        if (role) {
          await workspacesApi.setWorkspaceAccess(workspace.id, group.id, role);
        } else if (group.is_default) {
          await workspacesApi.removeWorkspaceAccess(workspace.id, group.id);
        }
      }

      await reloadAndSelect(workspace.id);
      setNewName("");
      setNewDescription("");
      setNewIcon(null);
      setNewColor(null);
      setGroups([]);
      setNewAccess({});
      setCreating(false);
      navigate("/collection");
      showToast("Colecao criada.");
    } catch (err: any) {
      setCreateError(extractErrorMessage(err) || "Nao foi possivel criar a colecao.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`settings-tab ${tab === t.key ? "settings-tab-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={changeViewMode} />
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <>
          {tab === "collections" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <p style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0 }}>Colecoes que voce tem acesso.</p>
                {isAnyAdmin && !creating && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
                    + Nova colecao
                  </button>
                )}
              </div>

              {creating && (
                <Modal
                  title="Nova colecao"
                  onClose={() => {
                    setCreating(false);
                    setGroups([]);
                    setNewAccess({});
                  }}
                >
                  <form onSubmit={handleCreateWorkspace}>
                    <input
                      className="input"
                      autoFocus
                      placeholder="Nome da colecao"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                      style={{ marginBottom: 10 }}
                    />
                    <textarea
                      className="input"
                      placeholder="Descricao (opcional)"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      rows={2}
                      style={{ marginBottom: 10, resize: "vertical" }}
                    />
                    <CollectionIconPicker
                      name={newName}
                      icon={newIcon}
                      color={newColor}
                      onChangeIcon={setNewIcon}
                      onChangeColor={setNewColor}
                    />
                    <AccessMatrixFields
                      groups={groups}
                      values={newAccess}
                      onChange={(groupId, value) => setNewAccess((prev) => ({ ...prev, [groupId]: value }))}
                    />
                    {createError && <p className="auth-error">{createError}</p>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" className="btn btn-primary" disabled={creatingWorkspace}>
                        {creatingWorkspace ? "Criando..." : "Criar"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setCreating(false);
                          setGroups([]);
                          setNewAccess({});
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                </Modal>
              )}

              {workspaces.length === 0 ? (
                <p style={{ color: "var(--color-text-muted)" }}>Nenhuma colecao disponivel.</p>
              ) : (
                <div
                  key={viewMode}
                  className={`view-mode-fade ${viewMode === "icon" ? "settings-grid" : ""}`}
                  style={viewMode === "list" ? { display: "flex", flexDirection: "column", gap: 8 } : undefined}
                >
                  {workspaces.map((w) => (
                    <CollectionCard
                      key={w.id}
                      workspace={w}
                      viewMode={viewMode}
                      onOpen={() => {
                        selectWorkspace(w.id);
                        navigate("/collection");
                      }}
                      onChanged={() => reloadAndSelect(currentWorkspace?.id ?? w.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "recommended" && (
            <CollectionEntryList
              entries={recommended}
              emptyMessage="Nenhuma recomendacao no momento."
              viewMode={viewMode}
              onOpen={openCollection}
            />
          )}

          {tab === "recent" && (
            <CollectionEntryList
              entries={recent}
              emptyMessage="Voce ainda nao visitou nenhuma colecao."
              viewMode={viewMode}
              onOpen={openCollection}
            />
          )}

          {tab === "favorites" && (
            <FavoriteReportList
              reports={favorites}
              workspaces={workspaces}
              emptyMessage="Voce ainda nao favoritou nenhum relatorio."
              viewMode={viewMode}
              onOpen={openReportCollection}
            />
          )}
        </>
      )}
    </div>
  );
}
