import { useEffect, useState } from "react";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_LABELS,
  assignPermissionLevel,
  createPermissionLevel,
  deletePermissionLevel,
  listPermissionLevels,
  updatePermissionLevel,
  type PermissionLevel,
} from "../../api/permissions";
import * as usersApi from "../../api/users";
import type { UserDirectoryEntry } from "../../api/users";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";

// Agrupa as chaves por prefixo pra exibir em secoes na edicao de nivel
const PERMISSION_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Colecoes",
    keys: ALL_PERMISSION_KEYS.filter((k) => k.startsWith("colecao.")),
  },
  {
    label: "Relatorios",
    keys: ALL_PERMISSION_KEYS.filter((k) => k.startsWith("relatorio.")),
  },
  {
    label: "Visuais",
    keys: ALL_PERMISSION_KEYS.filter((k) => k.startsWith("visual.")),
  },
  {
    label: "Assinaturas",
    keys: ALL_PERMISSION_KEYS.filter((k) => k.startsWith("assinatura.")),
  },
  {
    label: "Administracao",
    keys: ALL_PERMISSION_KEYS.filter((k) => k.startsWith("admin.")),
  },
];

function LevelModal({
  level,
  onClose,
  onSaved,
}: {
  level: PermissionLevel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(level?.name ?? "");
  const [description, setDescription] = useState(level?.description ?? "");
  const [grants, setGrants] = useState<Set<string>>(new Set(level?.grants ?? []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  function toggleGrant(key: string) {
    setGrants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      if (level) {
        await updatePermissionLevel(level.id, {
          name,
          description: description || undefined,
          grants: [...grants],
        });
        showToast("Nivel atualizado", "success");
      } else {
        await createPermissionLevel({ name, description: description || undefined, grants: [...grants] });
        showToast("Nivel criado", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={level ? "Editar nivel" : "Novo nivel de permissao"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label className="field">
          Nome
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            required
          />
        </label>
        <label className="field">
          Descricao
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
            placeholder="Opcional"
          />
        </label>

        <div className="field" style={{ gap: 8 }}>
          Permissoes
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>
                {group.label.toUpperCase()}
              </div>
              {group.keys.map((key) => (
                <label
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, cursor: "pointer", paddingBlock: 2 }}
                >
                  <input
                    type="checkbox"
                    checked={grants.has(key)}
                    onChange={() => toggleGrant(key)}
                    disabled={loading}
                  />
                  {PERMISSION_LABELS[key] ?? key}
                </label>
              ))}
            </div>
          ))}
        </div>

        {error && <p className="auth-error">{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={loading || !name.trim()} onClick={handleSubmit}>
            {loading ? "Salvando..." : "Salvar"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function PermissoesTab() {
  const [levels, setLevels] = useState<PermissionLevel[]>([]);
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [loadingLevels, setLoadingLevels] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [editingLevel, setEditingLevel] = useState<PermissionLevel | null | undefined>(undefined);
  const [deletingLevel, setDeletingLevel] = useState<PermissionLevel | null>(null);
  const [assigningError, setAssigningError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function loadLevels() {
    setLoadingLevels(true);
    try {
      setLevels(await listPermissionLevels());
    } finally {
      setLoadingLevels(false);
    }
  }

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      setUsers(await usersApi.listUsers());
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadLevels();
    loadUsers();
  }, []);

  async function handleDeleteLevel() {
    if (!deletingLevel) return;
    try {
      await deletePermissionLevel(deletingLevel.id);
      showToast("Nivel excluido", "success");
      await loadLevels();
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir", "error");
    } finally {
      setDeletingLevel(null);
    }
  }

  async function handleAssignLevel(userId: number, levelId: number | null) {
    setAssigningError(null);
    try {
      await assignPermissionLevel(userId, levelId);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, permission_level_id: levelId } : u))
      );
    } catch (err) {
      setAssigningError(extractErrorMessage(err) || "Nao foi possivel atribuir o nivel");
    }
  }

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 className="settings-section-title" style={{ marginBottom: 2 }}>Niveis de permissao</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
            Defina o que cada nivel pode fazer na plataforma. Administradores do grupo "Administradores" tem acesso total independente do nivel.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditingLevel(null)}>
          + Novo nivel
        </button>
      </div>

      {loadingLevels ? (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Carregando...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
          {levels.map((level) => (
            <div
              key={level.id}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{level.name}</span>
                  {level.is_system && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "1px 7px",
                        borderRadius: 10,
                        background: "var(--color-surface-raised)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      sistema
                    </span>
                  )}
                </div>
                {level.description && (
                  <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "2px 0 0" }}>{level.description}</p>
                )}
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
                  {level.grants.length === ALL_PERMISSION_KEYS.length
                    ? "Todas as permissoes"
                    : level.grants.length === 0
                    ? "Nenhuma permissao"
                    : `${level.grants.length} permissao${level.grants.length !== 1 ? "es" : ""}`}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setEditingLevel(level)}>
                  Editar
                </button>
                {!level.is_system && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 13, color: "var(--color-danger, red)" }}
                    onClick={() => setDeletingLevel(level)}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="settings-section-title" style={{ marginBottom: 8 }}>Atribuir nivel aos usuarios</h2>
      {assigningError && <p className="auth-error" style={{ marginBottom: 8 }}>{assigningError}</p>}

      {loadingUsers ? (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Carregando usuarios...</p>
      ) : (
        <table className="data-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>E-mail</th>
              <th>Nivel de permissao</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{user.email}</td>
                <td>
                  <select
                    className="input"
                    style={{ fontSize: 13, padding: "4px 8px" }}
                    value={user.permission_level_id ?? ""}
                    onChange={(e) => handleAssignLevel(user.id, e.target.value ? Number(e.target.value) : null)}
                    disabled={loadingLevels}
                  >
                    <option value="">-- Sem nivel --</option>
                    {levels.map((lv) => (
                      <option key={lv.id} value={lv.id}>
                        {lv.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editingLevel !== undefined && (
        <LevelModal
          level={editingLevel}
          onClose={() => setEditingLevel(undefined)}
          onSaved={loadLevels}
        />
      )}

      {deletingLevel && (
        <ConfirmDialog
          title="Excluir nivel"
          message={`Tem certeza que deseja excluir o nivel "${deletingLevel.name}"? Os usuarios com esse nivel ficarao sem nivel atribuido.`}
          confirmLabel="Excluir"
          onConfirm={handleDeleteLevel}
          onCancel={() => setDeletingLevel(null)}
        />
      )}
    </div>
  );
}
