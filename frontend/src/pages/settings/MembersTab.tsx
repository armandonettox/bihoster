import { useEffect, useRef, useState, type FormEvent } from "react";
import * as usersApi from "../../api/users";
import * as groupsApi from "../../api/groups";
import type { UserDirectoryEntry, PendingInvite } from "../../api/users";
import type { Group } from "../../api/groups";
import { SkeletonList } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useBranding } from "../../context/BrandingContext";
import { useAuth } from "../../context/AuthContext";
import { formatDateTime } from "../../utils/datetime";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import KebabMenu from "../../components/KebabMenu";
import { extractErrorMessage } from "../../api/client";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function formatLastLogin(value: string | null, timezone?: string): string {
  if (!value) return "Nunca acessou";
  return formatDateTime(value, timezone);
}

function GroupsDropdown({
  summary,
  groups,
  isMember,
  onToggle,
}: {
  summary: string;
  groups: Group[];
  isMember: (group: Group) => boolean;
  onToggle: (group: Group, checked: boolean) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [pendingGroupIds, setPendingGroupIds] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  async function handleToggle(group: Group, checked: boolean) {
    setPendingGroupIds((current) => new Set(current).add(group.id));
    try {
      await onToggle(group, checked);
    } finally {
      setPendingGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleToggleOpen() {
    // So abre pra cima quando nao sobra espaco embaixo (perto do fim da tabela/tela) --
    // sem isso, o dropdown podia extrapolar o rodape da janela sem jeito de fechar direito.
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 280 && rect.top > spaceBelow);
    }
    setOpen((o) => !o);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button type="button" className="groups-cell-trigger" onClick={handleToggleOpen}>
        {summary}
      </button>
      {open && (
        <div className={`groups-cell-dropdown ${openUpward ? "groups-cell-dropdown-up" : ""}`}>
          {groups.map((g) => (
            <label key={g.id} className="groups-cell-option">
              <input
                type="checkbox"
                checked={g.is_default || isMember(g)}
                disabled={g.is_default || pendingGroupIds.has(g.id)}
                onChange={(e) => handleToggle(g, e.target.checked)}
              />
              {g.name}
              {g.is_default && <span className="badge">padrao</span>}
              {g.is_admin_group && <span className="badge">admin</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupsCell({
  user,
  groups,
  onToggle,
}: {
  user: UserDirectoryEntry;
  groups: Group[];
  onToggle: (group: Group, checked: boolean) => void;
}) {
  const summary = user.groups.length > 0 ? user.groups.map((g) => g.name).join(", ") : "Nenhum grupo";
  return (
    <GroupsDropdown
      summary={summary}
      groups={groups}
      isMember={(g) => user.groups.some((ug) => ug.id === g.id)}
      onToggle={onToggle}
    />
  );
}

function InviteGroupsCell({
  invites,
  groups,
  onToggle,
}: {
  invites: PendingInvite[];
  groups: Group[];
  onToggle: (group: Group, checked: boolean) => void;
}) {
  const invitedNonDefaultNames = invites.map((i) => i.group_name);
  const defaultGroupName = groups.find((g) => g.is_default)?.name;
  const allNames = defaultGroupName ? [defaultGroupName, ...invitedNonDefaultNames] : invitedNonDefaultNames;
  const summary = allNames.length > 0 ? allNames.join(", ") : "Nenhum grupo";
  return (
    <GroupsDropdown
      summary={summary}
      groups={groups}
      isMember={(g) => invites.some((i) => i.group_id === g.id)}
      onToggle={onToggle}
    />
  );
}

export default function MembersTab() {
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetLinkRevealed, setResetLinkRevealed] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addingSaving, setAddingSaving] = useState(false);
  const [confirmingRemoveUser, setConfirmingRemoveUser] = useState<UserDirectoryEntry | null>(null);
  const [confirmingCancelInvite, setConfirmingCancelInvite] = useState<PendingInvite[] | null>(null);
  const { showToast } = useToast();
  const { settings } = useBranding();
  const { user: currentUser } = useAuth();

  async function load() {
    const [usersData, groupsData, invitesData] = await Promise.all([
      usersApi.listUsers(),
      groupsApi.listGroups(),
      usersApi.listPendingInvites(),
    ]);
    setUsers(usersData);
    setGroups(groupsData);
    setInvites(invitesData);
  }

  useEffect(() => {
    load()
      .catch(() => showToast("Nao foi possivel carregar os membros.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggle(userId: number, group: Group, checked: boolean) {
    try {
      if (checked) {
        const user = users.find((u) => u.id === userId);
        if (!user) return;
        await groupsApi.addGroupMember(group.id, user.email);
      } else {
        await groupsApi.removeGroupMember(group.id, userId);
      }
      await load();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel atualizar o grupo.", "error");
    }
  }

  async function handleGenerateResetLink(userId: number) {
    try {
      const { token } = await usersApi.generateResetLink(userId);
      setResetLink(`${window.location.origin}/reset-password?token=${token}`);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel gerar o link.", "error");
    }
  }

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    const defaultGroup = groups.find((g) => g.is_default);
    if (!defaultGroup) {
      setAddError("Nao foi possivel encontrar o grupo padrao -- recarregue a pagina e tente de novo.");
      return;
    }
    setAddError(null);
    setAddingSaving(true);
    try {
      const result = await groupsApi.inviteGroupMember(defaultGroup.id, newMemberEmail);
      setNewMemberEmail("");
      setAddingMember(false);
      await load();
      showToast(
        result.status === "added"
          ? "Membro adicionado."
          : "Convite criado -- a pessoa entra automaticamente quando se cadastrar."
      );
    } catch (err: any) {
      setAddError(extractErrorMessage(err) || "Nao foi possivel adicionar o membro.");
    } finally {
      setAddingSaving(false);
    }
  }

  async function handleRemoveUser(userId: number) {
    try {
      await usersApi.deleteUser(userId);
      await load();
      showToast("Membro removido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover o membro.", "error");
    }
  }

  async function handleCancelInvite(emailInvites: PendingInvite[]) {
    try {
      await Promise.all(emailInvites.map((invite) => groupsApi.cancelGroupInvite(invite.group_id, invite.id)));
      await load();
      showToast("Convite cancelado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel cancelar o convite.", "error");
    }
  }

  async function handleToggleInvite(email: string, emailInvites: PendingInvite[], group: Group, checked: boolean) {
    try {
      if (checked) {
        await groupsApi.inviteGroupMember(group.id, email);
      } else {
        const invite = emailInvites.find((i) => i.group_id === group.id);
        if (!invite) return;
        await groupsApi.cancelGroupInvite(group.id, invite.id);
      }
      await load();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel atualizar o grupo do convite.", "error");
    }
  }

  if (loading) {
    return <SkeletonList count={4} />;
  }

  const filteredUsers = users.filter((user) => {
    if (!filter) return true;
    const haystack = `${user.name} ${user.email}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });
  const filteredInvites = invites.filter((invite) => {
    if (!filter) return true;
    return invite.email.toLowerCase().includes(filter.toLowerCase());
  });
  // Convites sao um registro por (email, grupo) -- agrupa por email pra exibir uma linha so
  // por pessoa convidada, com todos os grupos dela editaveis no mesmo dropdown.
  const invitesByEmail = new Map<string, PendingInvite[]>();
  for (const invite of filteredInvites) {
    const list = invitesByEmail.get(invite.email) ?? [];
    list.push(invite);
    invitesByEmail.set(invite.email, list);
  }

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className="settings-section-title">Membros</h2>
          <p className="settings-section-desc">
            Aqui voce define a quais grupos cada pessoa pertence -- o nivel de acesso em cada colecao
            vem do grupo, configurado na aba <strong>Colecoes</strong>.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddingMember(true)} style={{ whiteSpace: "nowrap" }}>
          + Adicionar membro
        </button>
      </div>

      <input
        className="input"
        placeholder="Filtrar por nome ou email..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 320 }}
      />

      <div className="card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Grupos</th>
              <th>Ultimo acesso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {Array.from(invitesByEmail.entries()).map(([email, emailInvites]) => (
              <tr key={`invite-${email}`}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="user-avatar">{initials(email)}</div>
                    {email}
                  </div>
                </td>
                <td style={{ color: "var(--color-text-muted)" }}>{email}</td>
                <td>
                  <InviteGroupsCell
                    invites={emailInvites}
                    groups={groups}
                    onToggle={(group, checked) => handleToggleInvite(email, emailInvites, group, checked)}
                  />
                </td>
                <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  Aguardando cadastro
                </td>
                <td style={{ width: 40 }}>
                  <KebabMenu>
                    {(close) => (
                      <button
                        type="button"
                        className="kebab-menu-item kebab-menu-item-danger"
                        onClick={() => {
                          close();
                          setConfirmingCancelInvite(emailInvites);
                        }}
                      >
                        Cancelar convite
                      </button>
                    )}
                  </KebabMenu>
                </td>
              </tr>
            ))}
            {filteredUsers.map((user) => (
              <tr key={user.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="user-avatar">{initials(user.name)}</div>
                    {user.name}
                    {user.id === currentUser?.id && (
                      <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>(voce)</span>
                    )}
                  </div>
                </td>
                <td style={{ color: "var(--color-text-muted)" }}>{user.email}</td>
                <td>
                  <GroupsCell user={user} groups={groups} onToggle={(group, checked) => handleToggle(user.id, group, checked)} />
                </td>
                <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{formatLastLogin(user.last_login, settings?.timezone)}</td>
                <td style={{ width: 40 }}>
                  <KebabMenu>
                    {(close) => (
                      <>
                        <button
                          type="button"
                          className="kebab-menu-item"
                          onClick={() => {
                            close();
                            handleGenerateResetLink(user.id);
                          }}
                        >
                          Gerar link de redefinicao
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            type="button"
                            className="kebab-menu-item kebab-menu-item-danger"
                            onClick={() => {
                              close();
                              setConfirmingRemoveUser(user);
                            }}
                          >
                            Remover membro
                          </button>
                        )}
                      </>
                    )}
                  </KebabMenu>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && filteredInvites.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--color-text-muted)", textAlign: "center" }}>
                  Nenhum membro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addingMember && (
        <Modal title="Adicionar membro" onClose={() => setAddingMember(false)}>
          <form onSubmit={handleAddMember} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="field">
              Email
              <input
                className="input"
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="pessoa@empresa.com"
                required
                autoFocus
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Se a pessoa ja tiver conta, ela entra direto. Senao, um convite fica pendente ate ela se
                cadastrar com esse email.
              </span>
            </label>
            {addError && <p className="auth-error">{addError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={addingSaving}>
                {addingSaving ? "Adicionando..." : "Adicionar"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setAddingMember(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmingRemoveUser && (
        <ConfirmDialog
          title="Remover membro"
          message={`Remover ${confirmingRemoveUser.name} do sistema? A conta, os grupos e os favoritos da pessoa sao apagados. Essa acao nao pode ser desfeita.`}
          confirmLabel="Remover"
          onConfirm={() => {
            const userId = confirmingRemoveUser.id;
            setConfirmingRemoveUser(null);
            handleRemoveUser(userId);
          }}
          onCancel={() => setConfirmingRemoveUser(null)}
        />
      )}

      {confirmingCancelInvite && (
        <ConfirmDialog
          title="Cancelar convite"
          message={`Cancelar o convite pendente para ${confirmingCancelInvite[0].email}? A pessoa nao entrara mais automaticamente nos grupos convidados ao se cadastrar.`}
          confirmLabel="Cancelar convite"
          onConfirm={() => {
            const invitesToCancel = confirmingCancelInvite;
            setConfirmingCancelInvite(null);
            handleCancelInvite(invitesToCancel);
          }}
          onCancel={() => setConfirmingCancelInvite(null)}
        />
      )}

      {resetLink && (
        <Modal
          title="Link de redefinicao gerado"
          onClose={() => {
            setResetLink(null);
            setResetLinkRevealed(false);
          }}
        >
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            Copie e envie este link para a pessoa. Ele expira em 30 minutos e so pode ser usado uma vez.
            Evite deixar exposto na tela -- qualquer pessoa que veja pode usa-lo pra redefinir a senha da conta.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              readOnly
              type={resetLinkRevealed ? "text" : "password"}
              value={resetLink}
              onFocus={(e) => resetLinkRevealed && e.target.select()}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResetLinkRevealed((r) => !r)}>
              {resetLinkRevealed ? "Ocultar" : "Revelar"}
            </button>
          </div>
          <button
            className="btn btn-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(resetLink);
                showToast("Link copiado.");
              } catch {
                showToast("Nao foi possivel copiar automaticamente -- clique em Revelar pra ver e copiar manualmente.", "error");
              }
            }}
          >
            Copiar link
          </button>
        </Modal>
      )}
    </div>
  );
}
