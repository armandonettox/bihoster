import { useEffect, useState, type FormEvent } from "react";
import * as groupsApi from "../../api/groups";
import type { Group, GroupInvite, GroupMember } from "../../api/groups";
import { useToast } from "../../context/ToastContext";
import { SkeletonList } from "../../components/Skeleton";
import ConfirmDialog from "../../components/ConfirmDialog";
import KebabMenu from "../../components/KebabMenu";
import AddGroupMemberModal from "../../components/AddGroupMemberModal";
import RenameGroupModal from "../../components/RenameGroupModal";
import { extractErrorMessage } from "../../api/client";

export default function GroupsTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDeleteGroup, setConfirmingDeleteGroup] = useState<Group | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<Group | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [addingMemberGroup, setAddingMemberGroup] = useState<Group | null>(null);
  const [confirmingRemoveMember, setConfirmingRemoveMember] = useState<{ groupId: number; member: GroupMember } | null>(null);
  const { showToast } = useToast();

  async function loadGroups() {
    setGroups(await groupsApi.listGroups());
  }

  useEffect(() => {
    loadGroups()
      .catch(() => showToast("Nao foi possivel carregar os grupos.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (creatingGroup) return;
    setError(null);
    setCreatingGroup(true);
    try {
      await groupsApi.createGroup(name);
      setName("");
      await loadGroups();
      showToast("Grupo criado.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel criar o grupo.");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleDelete(groupId: number) {
    try {
      await groupsApi.deleteGroup(groupId);
      if (expandedGroup === groupId) setExpandedGroup(null);
      await loadGroups();
      showToast("Grupo excluido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir o grupo.", "error");
    }
  }

  async function handleExpand(groupId: number) {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
      return;
    }
    setExpandedGroup(groupId);
    const [members, invites] = await Promise.all([
      groupsApi.listGroupMembers(groupId),
      groupsApi.listGroupInvites(groupId),
    ]);
    // Reverifica apos o await -- se o usuario ja trocou pra outro grupo enquanto essa
    // requisicao estava em voo, aplicar o resultado aqui sobrescreveria os dados do
    // grupo que esta expandido agora com os do grupo antigo.
    setExpandedGroup((current) => {
      if (current === groupId) {
        setGroupMembers(members);
        setGroupInvites(invites);
      }
      return current;
    });
  }

  async function refreshExpandedGroup(groupId: number) {
    if (expandedGroup !== groupId) return;
    setGroupMembers(await groupsApi.listGroupMembers(groupId));
    setGroupInvites(await groupsApi.listGroupInvites(groupId));
  }

  async function handleRemoveMember(groupId: number, userId: number) {
    try {
      await groupsApi.removeGroupMember(groupId, userId);
      await refreshExpandedGroup(groupId);
      showToast("Membro removido do grupo.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover do grupo.", "error");
    }
  }

  async function handleCancelInvite(groupId: number, inviteId: number) {
    await groupsApi.cancelGroupInvite(groupId, inviteId);
    await refreshExpandedGroup(groupId);
    showToast("Convite cancelado.");
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Grupos</h2>
      <p className="settings-section-desc">
        Grupos sao globais -- valem pro sistema inteiro. Todo usuario cadastrado pertence sempre ao
        grupo <strong>Todos os usuarios</strong>. O nivel de acesso de cada grupo em cada colecao se
        configura na aba <strong>Colecoes</strong>.
      </p>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
        <input
          className="input"
          placeholder="Nome do grupo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary" style={{ whiteSpace: "nowrap" }} disabled={creatingGroup}>
          {creatingGroup ? "Criando..." : "Criar grupo"}
        </button>
      </form>
      {error && <p className="auth-error">{error}</p>}

      {loading ? (
        <SkeletonList count={3} />
      ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((group) => (
          <div key={group.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button className="settings-group-toggle" onClick={() => handleExpand(group.id)}>
                <span>{expandedGroup === group.id ? "▾" : "▸"}</span> {group.name}
              </button>
              {!group.is_default && (
                <KebabMenu>
                  {(close) => (
                    <>
                      <button
                        className="kebab-menu-item"
                        onClick={() => {
                          close();
                          setAddingMemberGroup(group);
                        }}
                      >
                        Adicionar/convidar membro
                      </button>
                      {!group.is_admin_group && (
                        <>
                          <button
                            className="kebab-menu-item"
                            onClick={() => {
                              close();
                              setRenamingGroup(group);
                            }}
                          >
                            Renomear
                          </button>
                          <button
                            className="kebab-menu-item kebab-menu-item-danger"
                            onClick={() => {
                              close();
                              setConfirmingDeleteGroup(group);
                            }}
                          >
                            Excluir grupo
                          </button>
                        </>
                      )}
                    </>
                  )}
                </KebabMenu>
              )}
            </div>

            {expandedGroup === group.id && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                  {groupMembers.map((m) => (
                    <li
                      key={m.user_id}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}
                    >
                      <span>
                        {m.name} <span style={{ color: "var(--color-text-muted)" }}>({m.email})</span>
                      </span>
                      {!group.is_default && (
                        <KebabMenu>
                          {(close) => (
                            <button
                              className="kebab-menu-item kebab-menu-item-danger"
                              onClick={() => {
                                close();
                                setConfirmingRemoveMember({ groupId: group.id, member: m });
                              }}
                            >
                              Remover do grupo
                            </button>
                          )}
                        </KebabMenu>
                      )}
                    </li>
                  ))}
                  {groupMembers.length === 0 && (
                    <li style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Nenhum membro no grupo.</li>
                  )}
                </ul>

                {groupInvites.length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                    {groupInvites.map((invite) => (
                      <li
                        key={invite.id}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}
                      >
                        <span>
                          {invite.email} <span className="badge">convite pendente</span>
                        </span>
                        <KebabMenu>
                          {(close) => (
                            <button
                              className="kebab-menu-item kebab-menu-item-danger"
                              onClick={() => {
                                close();
                                handleCancelInvite(group.id, invite.id);
                              }}
                            >
                              Cancelar convite
                            </button>
                          )}
                        </KebabMenu>
                      </li>
                    ))}
                  </ul>
                )}

                {group.is_default && (
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                    Todo usuario cadastrado entra aqui automaticamente.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {renamingGroup && (
        <RenameGroupModal
          group={renamingGroup}
          onSaved={loadGroups}
          onClose={() => setRenamingGroup(null)}
        />
      )}

      {addingMemberGroup && (
        <AddGroupMemberModal
          group={addingMemberGroup}
          onAdded={() => refreshExpandedGroup(addingMemberGroup.id)}
          onClose={() => setAddingMemberGroup(null)}
        />
      )}

      {confirmingRemoveMember && (
        <ConfirmDialog
          title="Remover do grupo"
          message={`Remover ${confirmingRemoveMember.member.name} do grupo?`}
          confirmLabel="Remover"
          onConfirm={() => {
            const { groupId, member } = confirmingRemoveMember;
            setConfirmingRemoveMember(null);
            handleRemoveMember(groupId, member.user_id);
          }}
          onCancel={() => setConfirmingRemoveMember(null)}
        />
      )}

      {confirmingDeleteGroup && (
        <ConfirmDialog
          title="Excluir grupo"
          message={`Excluir o grupo "${confirmingDeleteGroup.name}"? Os membros perdem o acesso que vinha desse grupo.`}
          confirmLabel="Excluir"
          onConfirm={() => {
            const groupId = confirmingDeleteGroup.id;
            setConfirmingDeleteGroup(null);
            handleDelete(groupId);
          }}
          onCancel={() => setConfirmingDeleteGroup(null)}
        />
      )}
    </div>
  );
}
