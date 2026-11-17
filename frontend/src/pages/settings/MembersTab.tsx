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
import { summarizeGroups, type GroupSummary } from "../../utils/memberGroups";
import { usePagination } from "../../hooks/usePagination";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import KebabMenu from "../../components/KebabMenu";
import MenuIcon from "../../components/MenuIcon";
import TablePagination from "../../components/TablePagination";
import { extractErrorMessage } from "../../api/client";

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function formatLastLogin(value: string | null, timezone?: string): string {
  if (!value) return "Nunca acessou";
  return formatDateTime(value, timezone);
}

/** O quadrado de grupos de uma linha: tamanho igual para todos, com o grupo principal, "+N" se houver mais, e a
 * lista completa em caixas de marcar quando se clica. */
function GroupsDropdown({
  owner,
  summary,
  groups,
  isMember,
  onToggle,
  inline = false,
  disabled = false,
}: {
  owner: string;
  summary: GroupSummary;
  groups: Group[];
  isMember: (group: Group) => boolean;
  onToggle: (group: Group, checked: boolean) => Promise<void> | void;
  /** Dentro de uma janela: o quadrado ocupa a largura toda e a lista abre no próprio fluxo (empurra o que vem
   * depois), em vez de flutuar sobre a janela e ficar cortada na borda dela. */
  inline?: boolean;
  disabled?: boolean;
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
    // Só abre para cima quando não sobra espaço embaixo (perto do fim da tabela ou da tela): sem isso, a lista
    // podia passar do rodapé da janela sem jeito de fechar direito.
    if (!inline && !open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 280 && rect.top > spaceBelow);
    }
    setOpen((o) => !o);
  }

  const accessibleName = `Grupos de ${owner}: ${summary.label}${summary.extra > 0 ? ` e mais ${summary.extra}` : ""}`;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={`groups-cell-trigger ${summary.muted ? "groups-cell-trigger-muted" : ""} ${inline ? "groups-cell-trigger-block" : ""}`}
        title={summary.title}
        aria-label={accessibleName}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={handleToggleOpen}
      >
        <span className="groups-cell-label">{summary.label}</span>
        {summary.extra > 0 && <span className="groups-cell-extra">+{summary.extra}</span>}
        <span className="material-symbols-outlined groups-cell-caret" aria-hidden="true">
          expand_more
        </span>
      </button>
      {open && (
        <div className={`groups-cell-dropdown ${openUpward ? "groups-cell-dropdown-up" : ""} ${inline ? "groups-cell-dropdown-inline" : ""}`}>
          {groups.map((g) => (
            <label key={g.id} className="groups-cell-option">
              <input
                type="checkbox"
                checked={g.is_default || isMember(g)}
                disabled={g.is_default || disabled || pendingGroupIds.has(g.id)}
                onChange={(e) => handleToggle(g, e.target.checked)}
              />
              {g.name}
              {g.is_default && <span className="badge">padrão</span>}
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
  return (
    <GroupsDropdown
      owner={user.name}
      summary={summarizeGroups(user.groups)}
      groups={groups}
      isMember={(g) => user.groups.some((ug) => ug.id === g.id)}
      onToggle={onToggle}
    />
  );
}

function InviteGroupsCell({
  email,
  invites,
  groups,
  onToggle,
}: {
  email: string;
  invites: PendingInvite[];
  groups: Group[];
  onToggle: (group: Group, checked: boolean) => void;
}) {
  // Quem se cadastra pelo convite entra sempre no grupo padrão, além dos grupos convidados
  const defaultGroup = groups.find((g) => g.is_default);
  const invited = invites.map((i) => ({
    name: i.group_name,
    is_default: groups.find((g) => g.id === i.group_id)?.is_default ?? false,
  }));
  const listed = defaultGroup ? [{ name: defaultGroup.name, is_default: true }, ...invited.filter((g) => !g.is_default)] : invited;
  return (
    <GroupsDropdown
      owner={email}
      summary={summarizeGroups(listed)}
      groups={groups}
      isMember={(g) => invites.some((i) => i.group_id === g.id)}
      onToggle={onToggle}
    />
  );
}

/** Uma linha da tabela: um convite pendente (agrupado por e-mail) ou uma pessoa com conta */
type Row = { kind: "invite"; email: string; invites: PendingInvite[] } | { kind: "user"; user: UserDirectoryEntry };

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
  // Grupos extras escolhidos na janela de adicionar (o padrão é automático e não entra aqui)
  const [newMemberGroupIds, setNewMemberGroupIds] = useState<Set<number>>(new Set());
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
      .catch(() => showToast("Não foi possível carregar os membros.", "error"))
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
      showToast(extractErrorMessage(err) || "Não foi possível atualizar o grupo.", "error");
    }
  }

  async function handleGenerateResetLink(userId: number) {
    try {
      const { token } = await usersApi.generateResetLink(userId);
      setResetLink(`${window.location.origin}/reset-password?token=${token}`);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível gerar o link.", "error");
    }
  }

  function closeAddMember() {
    setAddingMember(false);
    setNewMemberEmail("");
    setNewMemberGroupIds(new Set());
    setAddError(null);
  }

  function toggleNewMemberGroup(group: Group, checked: boolean) {
    setNewMemberGroupIds((current) => {
      const next = new Set(current);
      if (checked) next.add(group.id);
      else next.delete(group.id);
      return next;
    });
  }

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    const defaultGroup = groups.find((g) => g.is_default);
    if (!defaultGroup) {
      setAddError("Não foi possível encontrar o grupo padrão. Recarregue a página e tente de novo.");
      return;
    }
    setAddError(null);
    setAddingSaving(true);
    try {
      // O grupo padrão vai primeiro: é ele que cria a conta (ou o convite) da pessoa. Se falhar (e-mail inválido, por
      // exemplo), nada mais é feito e o erro aparece na própria janela.
      const result = await groupsApi.inviteGroupMember(defaultGroup.id, newMemberEmail);
      const chosen = groups.filter((g) => !g.is_default && newMemberGroupIds.has(g.id));
      const failed: string[] = [];
      for (const group of chosen) {
        try {
          await groupsApi.inviteGroupMember(group.id, newMemberEmail);
        } catch {
          failed.push(group.name);
        }
      }
      closeAddMember();
      await load();

      const done = chosen.filter((g) => !failed.includes(g.name)).map((g) => g.name);
      const added = result.status === "added";
      if (failed.length > 0) {
        // A pessoa já foi adicionada (ou convidada); só alguns grupos falharam e podem ser refeitos na coluna Grupos
        showToast(
          `${added ? "Membro adicionado" : "Convite criado"}, mas não foi possível incluir nos grupos: ${failed.join(", ")}. Use a coluna Grupos para tentar de novo.`,
          "error"
        );
        return;
      }
      const base = added ? "Membro adicionado." : "Convite criado. A pessoa entra automaticamente quando se cadastrar.";
      showToast(done.length > 0 ? `${base} Grupos: ${done.join(", ")}.` : base);
    } catch (err: any) {
      setAddError(extractErrorMessage(err) || "Não foi possível adicionar o membro.");
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
      showToast(extractErrorMessage(err) || "Não foi possível remover o membro.", "error");
    }
  }

  async function handleCancelInvite(emailInvites: PendingInvite[]) {
    try {
      await Promise.all(emailInvites.map((invite) => groupsApi.cancelGroupInvite(invite.group_id, invite.id)));
      await load();
      showToast("Convite cancelado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível cancelar o convite.", "error");
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
      showToast(extractErrorMessage(err) || "Não foi possível atualizar o grupo do convite.", "error");
    }
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
  // Convites são um registro por (e-mail, grupo): agrupa por e-mail para mostrar uma linha só por pessoa convidada,
  // com todos os grupos dela editáveis no mesmo seletor.
  const invitesByEmail = new Map<string, PendingInvite[]>();
  for (const invite of filteredInvites) {
    const list = invitesByEmail.get(invite.email) ?? [];
    list.push(invite);
    invitesByEmail.set(invite.email, list);
  }

  // Os convites vêm primeiro, depois as pessoas. A tabela mostra uma página por vez (20 linhas, por padrão); mudar o
  // filtro volta para a primeira página.
  const rows: Row[] = [
    ...Array.from(invitesByEmail.entries()).map(([email, emailInvites]): Row => ({ kind: "invite", email, invites: emailInvites })),
    ...filteredUsers.map((user): Row => ({ kind: "user", user })),
  ];
  const pagination = usePagination(rows, filter);

  if (loading) {
    return <SkeletonList count={4} />;
  }

  const defaultGroup = groups.find((g) => g.is_default);
  const defaultGroupName = defaultGroup?.name ?? "Todos os usuários";
  // O que o seletor da janela de adicionar mostra: o padrão (em cinza) enquanto nada foi marcado e, depois, o primeiro
  // grupo marcado com "+N", exatamente como o quadrado de grupos da tabela
  const newMemberSummary = summarizeGroups([
    ...(defaultGroup ? [defaultGroup] : []),
    ...groups.filter((g) => !g.is_default && newMemberGroupIds.has(g.id)),
  ]);

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className="settings-section-title">Membros</h2>
          <p className="settings-section-desc">
            Aqui você define a quais grupos cada pessoa pertence. O nível de acesso em cada coleção vem do grupo,
            configurado na aba <strong>Coleções</strong>.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddingMember(true)} style={{ whiteSpace: "nowrap" }}>
          + Adicionar membro
        </button>
      </div>

      <input
        className="input"
        placeholder="Filtrar por nome ou e-mail..."
        aria-label="Filtrar membros por nome ou e-mail"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 6, maxWidth: 320 }}
      />
      <p className="field-hint" style={{ marginBottom: 16 }}>
        “{defaultGroupName}” é o grupo padrão de todas as pessoas, por isso só aparece na coluna Grupos quando a pessoa
        não está em nenhum outro.
      </p>

      <div className="card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Grupos</th>
              <th>Último acesso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((row) =>
              row.kind === "invite" ? (
                <tr key={`invite-${row.email}`}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="user-avatar">{initials(row.email)}</div>
                      {row.email}
                    </div>
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>{row.email}</td>
                  <td>
                    <InviteGroupsCell
                      email={row.email}
                      invites={row.invites}
                      groups={groups}
                      onToggle={(group, checked) => handleToggleInvite(row.email, row.invites, group, checked)}
                    />
                  </td>
                  <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Aguardando cadastro</td>
                  <td style={{ width: 40 }}>
                    <KebabMenu>
                      {(close) => (
                        <button
                          type="button"
                          className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                          onClick={() => {
                            close();
                            setConfirmingCancelInvite(row.invites);
                          }}
                        >
                          <MenuIcon name="close" />
                          Cancelar convite
                        </button>
                      )}
                    </KebabMenu>
                  </td>
                </tr>
              ) : (
                <tr key={row.user.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="user-avatar">{initials(row.user.name)}</div>
                      {row.user.name}
                      {row.user.id === currentUser?.id && (
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>(você)</span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>{row.user.email}</td>
                  <td>
                    <GroupsCell
                      user={row.user}
                      groups={groups}
                      onToggle={(group, checked) => handleToggle(row.user.id, group, checked)}
                    />
                  </td>
                  <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {formatLastLogin(row.user.last_login, settings?.timezone)}
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
                              handleGenerateResetLink(row.user.id);
                            }}
                          >
                            <MenuIcon name="link" />
                            Gerar link de redefinição
                          </button>
                          {row.user.id !== currentUser?.id && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
                              onClick={() => {
                                close();
                                setConfirmingRemoveUser(row.user);
                              }}
                            >
                              <MenuIcon name="person_remove" />
                              Remover membro
                            </button>
                          )}
                        </>
                      )}
                    </KebabMenu>
                  </td>
                </tr>
              ),
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--color-text-muted)", textAlign: "center" }}>
                  Nenhum membro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <TablePagination
          total={pagination.total}
          page={pagination.page}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}

      {addingMember && (
        <Modal title="Adicionar membro" onClose={closeAddMember}>
          <form onSubmit={handleAddMember} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="field">
              E-mail
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
                Se a pessoa já tiver conta, ela entra direto. Senão, um convite fica pendente até ela se cadastrar
                com esse e-mail.
              </span>
            </label>

            <div className="field">
              <span>Grupos</span>
              <GroupsDropdown
                owner="a nova pessoa"
                summary={newMemberSummary}
                groups={groups}
                isMember={(g) => newMemberGroupIds.has(g.id)}
                onToggle={toggleNewMemberGroup}
                inline
                disabled={addingSaving}
              />
              <span className="field-hint">
                “{defaultGroupName}” é automático para todas as pessoas. Marque os outros grupos em que ela deve entrar;
                se a pessoa ainda não tiver conta, ela entra neles quando se cadastrar.
              </span>
            </div>

            {addError && <p className="auth-error">{addError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={addingSaving}>
                {addingSaving ? "Adicionando..." : "Adicionar"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeAddMember}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmingRemoveUser && (
        <ConfirmDialog
          title="Remover membro"
          message={`Remover ${confirmingRemoveUser.name} do sistema? A conta, os grupos e os favoritos da pessoa são apagados. Essa ação não pode ser desfeita.`}
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
          message={`Cancelar o convite pendente para ${confirmingCancelInvite[0].email}? A pessoa não entrará mais automaticamente nos grupos convidados ao se cadastrar.`}
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
          title="Link de redefinição gerado"
          onClose={() => {
            setResetLink(null);
            setResetLinkRevealed(false);
          }}
        >
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            Copie e envie este link para a pessoa. Ele expira em 30 minutos e só pode ser usado uma vez. Evite deixar
            exposto na tela: qualquer pessoa que o veja pode usá-lo para redefinir a senha da conta.
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
                showToast("Não foi possível copiar automaticamente. Clique em Revelar para ver e copiar manualmente.", "error");
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
