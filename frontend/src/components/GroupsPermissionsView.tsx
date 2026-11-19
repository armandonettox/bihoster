import { useState } from "react";
import type { GroupGrants } from "../api/access";
import { extractErrorMessage } from "../api/client";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import type { PendingInvite, UserDirectoryEntry } from "../api/users";
import { useAccess } from "../context/AccessContext";
import { useToast } from "../context/ToastContext";
import AccessEditor from "./AccessEditor";
import AccessHero from "./AccessHero";
import AddGroupMemberModal from "./AddGroupMemberModal";
import ConfirmDialog from "./ConfirmDialog";
import CreateGroupModal from "./CreateGroupModal";
import KebabMenu from "./KebabMenu";
import MenuIcon from "./MenuIcon";
import Modal from "./Modal";
import PermissionsBox from "./PermissionsBox";
import RenameGroupModal from "./RenameGroupModal";

interface Props {
  groups: Group[];
  users: UserDirectoryEntry[];
  /** Convites pendentes de todos os grupos (cada um diz de qual é) */
  invites: PendingInvite[];
  grants: GroupGrants[];
  /** Texto da busca: filtra os grupos pelo nome */
  filter: string;
  /** Chamada depois de qualquer mudança (grupo criado, renomeado, excluído, gente entrando ou saindo, permissões),
   * para a tabela recarregar */
  onChanged: () => void;
  /** A janela de criar grupo está aberta? Quem abre é o botão "Adicionar grupo" do topo da página */
  creating: boolean;
  onCloseCreate: () => void;
}

const MAX_TAGS = 12;

/** A visão "por grupo" de Gerenciar usuários: cada grupo com quantas pessoas tem e o resumo do que ele dá, mais tudo o que
 * se faz com grupos: criar, renomear, excluir, colocar e tirar gente, cancelar convites e editar as permissões. Cada ação
 * só aparece para quem tem a permissão dela. O menu dos três pontinhos abre a janela do grupo. */
export default function GroupsPermissionsView({ groups, users, invites, grants, filter, onChanged, creating, onCloseCreate }: Props) {
  const access = useAccess();
  const { showToast } = useToast();
  // Cada acao tem a sua permissao; quem so ve (sem poder dar permissoes) abre a janela do grupo em modo leitura
  const canRename = access.can("grupos.editar");
  const canDelete = access.can("grupos.excluir");
  const canGivePermissions = access.can("permissoes.editar");
  const canCancelInvite = access.can("membros.convites");
  // Colocar e tirar gente de um grupo: o grupo Administradores e so do administrador da plataforma
  const canPutIn = (group: Group) =>
    (!group.is_admin_group || access.isAdmin) && access.canAny("membros.adicionar", "grupos.participantes");
  const canTakeOut = (group: Group) =>
    (!group.is_admin_group || access.isAdmin) && access.canAny("grupos.participantes", "membros.editar");

  const [editing, setEditing] = useState<Group | null>(null);
  const [renaming, setRenaming] = useState<Group | null>(null);
  const [addingTo, setAddingTo] = useState<Group | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Group | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<{ group: Group; user: UserDirectoryEntry } | null>(null);

  const visible = groups.filter((group) => !filter || group.name.toLowerCase().includes(filter.toLowerCase()));
  const membersOf = (group: Group) => users.filter((user) => user.groups.some((g) => g.id === group.id));
  const invitesOf = (group: Group) => invites.filter((invite) => invite.group_id === group.id);
  const grantsOf = (group: Group) => grants.find((g) => g.group_id === group.id);

  function countOf(group: Group): number {
    return (grantsOf(group)?.blocks ?? []).reduce((total, block) => total + block.permissions.length, 0);
  }

  function summaryOf(group: Group) {
    if (group.is_admin_group) return { label: "Todas as permissões", muted: true, title: "Todas as permissões, em todas as coleções" };
    const count = countOf(group);
    if (count === 0) return { label: "Nenhuma permissão", muted: true, title: "Nenhuma permissão" };
    return { label: `${count} ${count === 1 ? "permissão" : "permissões"}`, muted: false, title: undefined };
  }

  function heroOf(group: Group) {
    const members = membersOf(group).map((member) => member.name);
    const shown = members.slice(0, MAX_TAGS);
    const blocks = grantsOf(group)?.blocks ?? [];
    return {
      subtitle: group.is_default
        ? "Grupo padrão: todo usuário cadastrado entra nele"
        : group.is_admin_group
          ? "Grupo de administradores da plataforma"
          : "Grupo",
      tags: members.length > MAX_TAGS ? [...shown, `+${members.length - MAX_TAGS}`] : shown,
      stats: [
        { label: "Pessoas", value: String(members.length) },
        { label: "Permissões", value: group.is_admin_group ? "Todas" : String(countOf(group)) },
        { label: "Coleções", value: group.is_admin_group ? "Todas" : String(blocks.filter((b) => b.workspace_id !== null && b.permissions.length > 0).length) },
      ],
    };
  }

  async function handleDelete(group: Group) {
    try {
      await groupsApi.deleteGroup(group.id);
      if (editing?.id === group.id) setEditing(null);
      onChanged();
      showToast("Grupo excluido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir o grupo.", "error");
    }
  }

  async function handleRemoveMember(group: Group, user: UserDirectoryEntry) {
    try {
      await groupsApi.removeGroupMember(group.id, user.id);
      onChanged();
      showToast("Membro removido do grupo.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover do grupo.", "error");
    }
  }

  async function handleCancelInvite(group: Group, invite: PendingInvite) {
    try {
      await groupsApi.cancelGroupInvite(group.id, invite.id);
      onChanged();
      showToast("Convite cancelado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel cancelar o convite.", "error");
    }
  }

  return (
    <>
      <div className="card data-table-card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Membros</th>
              <th>Permissões</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => {
              const members = membersOf(group);
              const summary = summaryOf(group);
              return (
                <tr key={group.id}>
                  <td>
                    <strong>{group.name}</strong>
                    {group.is_default && <span className="badge">padrão</span>}
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    {members.length} {members.length === 1 ? "pessoa" : "pessoas"}
                  </td>
                  <td>
                    <PermissionsBox label={summary.label} muted={summary.muted} title={summary.title} />
                  </td>
                  <td style={{ width: 40 }}>
                    <KebabMenu>
                      {(close) => (
                        <>
                          <button
                            type="button"
                            className="kebab-menu-item kebab-menu-item-with-icon"
                            onClick={() => {
                              close();
                              setEditing(group);
                            }}
                          >
                            <MenuIcon name={canGivePermissions ? "edit" : "visibility"} />
                            {canGivePermissions ? "Editar" : "Ver permissões"}
                          </button>
                          {!group.is_default && canPutIn(group) && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon"
                              onClick={() => {
                                close();
                                setAddingTo(group);
                              }}
                            >
                              <MenuIcon name="person_add" />
                              Adicionar/convidar membro
                            </button>
                          )}
                          {!group.is_default && !group.is_admin_group && canRename && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon"
                              onClick={() => {
                                close();
                                setRenaming(group);
                              }}
                            >
                              <MenuIcon name="drive_file_rename_outline" />
                              Renomear
                            </button>
                          )}
                          {!group.is_default && !group.is_admin_group && canDelete && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                              onClick={() => {
                                close();
                                setConfirmingDelete(group);
                              }}
                            >
                              <MenuIcon name="delete" />
                              Excluir grupo
                            </button>
                          )}
                        </>
                      )}
                    </KebabMenu>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "var(--color-text-muted)", textAlign: "center" }}>
                  Nenhum grupo encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal
          title="Editar grupo"
          wide
          onClose={() => {
            setEditing(null);
            // As permissões podem ter mudado: recarrega a tabela
            onChanged();
          }}
        >
          <AccessHero initials={editing.name.trim().slice(0, 2).toUpperCase()} name={editing.name} tagsLabel="Membros" {...heroOf(editing)} />

          {!editing.is_default && (
            <section className="access-card" aria-label="Participantes do grupo">
              <div className="access-card-head">
                <h4 className="access-card-title">Participantes</h4>
                {canPutIn(editing) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingTo(editing)}>
                    Adicionar/convidar membro
                  </button>
                )}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {membersOf(editing).map((user) => (
                  <li
                    key={user.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}
                  >
                    <span>
                      {user.name} <span style={{ color: "var(--color-text-muted)" }}>({user.email})</span>
                    </span>
                    {canTakeOut(editing) && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingRemove({ group: editing, user })}>
                        Remover do grupo
                      </button>
                    )}
                  </li>
                ))}
                {membersOf(editing).length === 0 && invitesOf(editing).length === 0 && (
                  <li style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Nenhum membro no grupo.</li>
                )}
                {invitesOf(editing).map((invite) => (
                  <li
                    key={invite.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13 }}
                  >
                    <span>
                      {invite.email} <span className="badge">convite pendente</span>
                    </span>
                    {canCancelInvite && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCancelInvite(editing, invite)}>
                        Cancelar convite
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AccessEditor
            kind="group"
            id={editing.id}
            intro={
              editing.is_default
                ? "Estas permissões valem para todo usuário cadastrado, que entra neste grupo automaticamente."
                : "Estas permissões valem para todas as pessoas do grupo."
            }
            readOnly={!canGivePermissions}
            allowed={access.holds}
          />
        </Modal>
      )}

      {creating && <CreateGroupModal onCreated={onChanged} onClose={onCloseCreate} />}

      {renaming && <RenameGroupModal group={renaming} onSaved={onChanged} onClose={() => setRenaming(null)} />}

      {addingTo && <AddGroupMemberModal group={addingTo} onAdded={onChanged} onClose={() => setAddingTo(null)} />}

      {confirmingRemove && (
        <ConfirmDialog
          title="Remover do grupo"
          message={`Remover ${confirmingRemove.user.name} do grupo?`}
          confirmLabel="Remover"
          onConfirm={() => {
            const { group, user } = confirmingRemove;
            setConfirmingRemove(null);
            handleRemoveMember(group, user);
          }}
          onCancel={() => setConfirmingRemove(null)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir grupo"
          message={`Excluir o grupo "${confirmingDelete.name}"? Os membros perdem o acesso que vinha desse grupo.`}
          confirmLabel="Excluir"
          onConfirm={() => {
            const group = confirmingDelete;
            setConfirmingDelete(null);
            handleDelete(group);
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </>
  );
}
