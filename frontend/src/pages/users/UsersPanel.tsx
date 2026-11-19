import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import * as usersApi from "../../api/users";
import * as groupsApi from "../../api/groups";
import * as accessApi from "../../api/access";
import { getEmailStatus } from "../../api/emailSettings";
import { listAllWorkspaces } from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
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
import AccessEditor from "../../components/AccessEditor";
import { useAccess } from "../../context/AccessContext";
import AccessForm from "../../components/AccessForm";
import AccessHero from "../../components/AccessHero";
import GroupsPermissionsView from "../../components/GroupsPermissionsView";
import PermissionsBox from "../../components/PermissionsBox";
import { blocksFromDraft } from "../../utils/accessDraft";
import type { Draft } from "../../utils/accessDraft";
import { summarizeAccess } from "../../utils/accessInherited";
import type { AccessSummary } from "../../utils/accessInherited";
import ConfirmDialog from "../../components/ConfirmDialog";
import KebabMenu from "../../components/KebabMenu";
import MenuIcon from "../../components/MenuIcon";
import UserAvatar from "../../components/UserAvatar";
import ScheduleEditor from "../../components/ScheduleEditor";
import { formatPersonName } from "../../utils/personName";
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
  disabled = false,
}: {
  user: UserDirectoryEntry;
  groups: Group[];
  onToggle: (group: Group, checked: boolean) => void;
  /** Quem não pode mudar os grupos das pessoas só vê */
  disabled?: boolean;
}) {
  return (
    <GroupsDropdown
      owner={formatPersonName(user.name)}
      summary={summarizeGroups(user.groups)}
      groups={groups}
      isMember={(g) => user.groups.some((ug) => ug.id === g.id)}
      onToggle={onToggle}
      disabled={disabled}
    />
  );
}

function InviteGroupsCell({
  email,
  invites,
  groups,
  onToggle,
  disabled = false,
}: {
  email: string;
  invites: PendingInvite[];
  groups: Group[];
  onToggle: (group: Group, checked: boolean) => void;
  disabled?: boolean;
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
      disabled={disabled}
    />
  );
}

/** Uma linha da tabela: um convite pendente (agrupado por e-mail) ou uma pessoa com conta */
type Row = { kind: "invite"; email: string; invites: PendingInvite[] } | { kind: "user"; user: UserDirectoryEntry };

/** Filtros por permissão, além da busca por texto: quem está em tal grupo, quem pode algo numa coleção etc. */
interface AccessFilterState {
  groupId: string;
  scope: string;
  permission: string;
  onlyDirect: boolean;
}

const NO_ACCESS_FILTERS: AccessFilterState = { groupId: "", scope: "", permission: "", onlyDirect: false };

/** O resumo de permissões de uma pessoa: o total, ou "Todas" para quem é administrador. Só informa; editar é pelo menu. */
function MemberPermissionsBox({ summary }: { summary: AccessSummary | undefined }) {
  const label = !summary
    ? "Permissões"
    : summary.isAdmin
      ? "Todas as permissões"
      : summary.count === 0
        ? "Nenhuma permissão"
        : `${summary.count} ${summary.count === 1 ? "permissão" : "permissões"}`;
  return (
    <PermissionsBox
      label={label}
      muted={!summary || summary.isAdmin || summary.count === 0}
      title={summary?.title}
      badge={summary?.hasDirect ? "avulsa" : undefined}
    />
  );
}

export default function UsersPanel() {
  // Cada acao tem a sua permissao: quem ve a aba (membros.ver) so faz o que as outras permitem
  const access = useAccess();
  const canAddMember = access.can("membros.adicionar");
  const canChangeGroups = access.canAny("membros.editar", "grupos.participantes");
  const canGivePermissions = access.can("permissoes.editar");
  const canResetPassword = access.can("membros.senha");
  const canBlock = access.can("membros.bloquear");
  const canRemoveMember = access.can("membros.remover");
  const canManageInvites = access.can("membros.convites");
  const canSeeGroups = access.can("grupos.ver");
  const canCreateGroup = access.can("grupos.criar");
  // A janela de criar grupo abre pelo botao do topo, que so aparece na visao por grupo
  const [creatingGroup, setCreatingGroup] = useState(false);
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
  // E-mail de aviso: só dá para mandar com o servidor de e-mail configurado. Desligado por padrão ao adicionar.
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [notifyByEmail, setNotifyByEmail] = useState(false);
  const [confirmingBlockUser, setConfirmingBlockUser] = useState<UserDirectoryEntry | null>(null);
  // Grupos extras escolhidos na janela de adicionar (o padrão é automático e não entra aqui)
  const [newMemberGroupIds, setNewMemberGroupIds] = useState<Set<number>>(new Set());
  const [confirmingRemoveUser, setConfirmingRemoveUser] = useState<UserDirectoryEntry | null>(null);
  const [editingAccessUser, setEditingAccessUser] = useState<UserDirectoryEntry | null>(null);
  const [confirmingCancelInvite, setConfirmingCancelInvite] = useState<PendingInvite[] | null>(null);
  // Permissões: resumo de cada pessoa, lista de coleções e catálogo (para os filtros e para a janela de adicionar)
  const [accessSummary, setAccessSummary] = useState<Map<number, AccessSummary>>(new Map());
  // As permissões de cada grupo (visão por grupo) e o que a tabela mostra: as pessoas ou os grupos
  const [groupGrants, setGroupGrants] = useState<accessApi.GroupGrants[]>([]);
  const [catalog, setCatalog] = useState<accessApi.AccessCatalog | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [accessFilters, setAccessFilters] = useState<AccessFilterState>(NO_ACCESS_FILTERS);
  // Quem passa nos filtros de permissão (o servidor calcula); `key` diz a que filtros a resposta pertence
  const [matched, setMatched] = useState<{ key: string; userIds: Set<number> } | null>(null);
  // Permissões avulsas escolhidas na janela de adicionar (valem para a pessoa, além das dos grupos)
  const [newMemberDraft, setNewMemberDraft] = useState<Draft>({});
  const { showToast } = useToast();
  const { settings } = useBranding();
  const { user: currentUser } = useAuth();
  // A visao (por membro ou por grupo) fica na URL: dá para compartilhar o link e recarregar sem perder onde estava.
  // A visao por grupo so existe para quem pode ver os grupos.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: "members" | "groups" = canSeeGroups && searchParams.get("view") === "groups" ? "groups" : "members";
  function setView(next: "members" | "groups") {
    setSearchParams(next === "groups" ? { view: "groups" } : {}, { replace: true });
  }

  async function load() {
    const [usersData, groupsData, invitesData, reportRows, grantsData] = await Promise.all([
      usersApi.listUsers(),
      groupsApi.listGroups(),
      usersApi.listPendingInvites(),
      // Sem as permissões a tabela continua útil: a coluna só fica sem o resumo
      accessApi.getAccessReport({}).catch(() => [] as accessApi.ReportRow[]),
      canSeeGroups ? accessApi.listGroupsGrants().catch(() => [] as accessApi.GroupGrants[]) : Promise.resolve([] as accessApi.GroupGrants[]),
    ]);
    setUsers(usersData);
    setGroups(groupsData);
    setInvites(invitesData);
    setAccessSummary(summarizeAccess(reportRows));
    setGroupGrants(grantsData);
  }

  useEffect(() => {
    load()
      .catch(() => showToast("Não foi possível carregar os membros.", "error"))
      .finally(() => setLoading(false));
    getEmailStatus()
      .then((status) => setEmailConfigured(status.configured))
      .catch(() => setEmailConfigured(false));
    Promise.all([accessApi.getAccessCatalog(), listAllWorkspaces()])
      .then(([loadedCatalog, loadedWorkspaces]) => {
        setCatalog(loadedCatalog);
        setWorkspaces(loadedWorkspaces);
      })
      .catch(() => {
        // Sem o catálogo os filtros de permissão e a escolha ao adicionar ficam escondidos; o resto funciona
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accessFilterKey = JSON.stringify(accessFilters);
  const hasAccessFilter = accessFilterKey !== JSON.stringify(NO_ACCESS_FILTERS);
  useEffect(() => {
    if (!hasAccessFilter) return;
    let cancelled = false;
    accessApi
      .getAccessReport({
        group_id: accessFilters.groupId ? Number(accessFilters.groupId) : undefined,
        scope: accessFilters.scope || undefined,
        permission: accessFilters.permission || undefined,
        only_direct: accessFilters.onlyDirect,
      })
      .then((rows) => !cancelled && setMatched({ key: accessFilterKey, userIds: new Set(rows.map((row) => row.user_id)) }))
      .catch(() => {
        if (!cancelled) {
          setMatched({ key: accessFilterKey, userIds: new Set() });
          showToast("Não foi possível aplicar o filtro de permissões.", "error");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessFilterKey, hasAccessFilter]);

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

  async function handleSendResetEmail(user: UserDirectoryEntry) {
    try {
      await usersApi.sendResetEmail(user.id);
      showToast(`Link de redefinição enviado para ${user.email}.`);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar o e-mail.", "error");
    }
  }

  async function handleSendWelcomeEmail(email: string) {
    try {
      await usersApi.sendWelcomeEmail(email);
      showToast(`E-mail enviado para ${email}.`);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar o e-mail.", "error");
    }
  }

  async function handleBlock(user: UserDirectoryEntry, block: boolean) {
    try {
      if (block) await usersApi.blockUser(user.id);
      else await usersApi.unblockUser(user.id);
      await load();
      showToast(block ? `${formatPersonName(user.name)} foi bloqueado.` : `${formatPersonName(user.name)} foi desbloqueado.`);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível alterar o bloqueio.", "error");
    }
  }

  function closeAddMember() {
    setAddingMember(false);
    setNotifyByEmail(false);
    setNewMemberEmail("");
    setNewMemberGroupIds(new Set());
    setNewMemberDraft({});
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
      // Permissões avulsas: aplicadas na hora se a pessoa já tem conta, ou reservadas no convite
      const blocks = blocksFromDraft(newMemberDraft);
      let permissionsFailed = false;
      if (blocks.length > 0) {
        try {
          await accessApi.grantByEmail(newMemberEmail, blocks);
        } catch {
          permissionsFailed = true;
        }
      }
      // Aviso por e-mail (se ligado): a falha não desfaz a adição, só avisa
      let emailFailed = false;
      if (notifyByEmail && emailConfigured) {
        try {
          await usersApi.sendWelcomeEmail(newMemberEmail);
        } catch {
          emailFailed = true;
        }
      }
      const emailSent = notifyByEmail && emailConfigured && !emailFailed;
      closeAddMember();
      await load();

      const done = chosen.filter((g) => !failed.includes(g.name)).map((g) => g.name);
      const added = result.status === "added";
      if (emailFailed) {
        showToast(
          `${added ? "Membro adicionado" : "Convite criado"}, mas o e-mail de aviso não foi enviado. Use o menu dos 3 pontinhos para tentar de novo.`,
          "error",
        );
        return;
      }
      if (failed.length > 0 || permissionsFailed) {
        // A pessoa já foi adicionada (ou convidada); só uma parte falhou e pode ser refeita na própria tabela
        const start = added ? "Membro adicionado" : "Convite criado";
        if (!permissionsFailed) {
          showToast(`${start}, mas não foi possível incluir nos grupos: ${failed.join(", ")}. Use a coluna Grupos para tentar de novo.`, "error");
          return;
        }
        const problems = [
          ...(failed.length > 0 ? [`incluir nos grupos: ${failed.join(", ")}`] : []),
          "gravar as permissões",
        ];
        showToast(`${start}, mas não foi possível ${problems.join(" nem ")}. Corrija pelas colunas Grupos e Permissões.`, "error");
        return;
      }
      const base = added ? "Membro adicionado." : "Convite criado. A pessoa entra automaticamente quando se cadastrar.";
      const extras = [
        ...(done.length > 0 ? [`Grupos: ${done.join(", ")}.`] : []),
        ...(blocks.length > 0 ? ["Permissões salvas."] : []),
        ...(emailSent ? ["E-mail de aviso enviado."] : []),
      ];
      showToast([base, ...extras].join(" "));
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

  // Quem passa nos filtros de permissão vem do servidor; enquanto a resposta não chega, a tabela fica sem linhas
  const accessMatch = hasAccessFilter && matched?.key === accessFilterKey ? matched.userIds : null;
  const accessFilterLoading = hasAccessFilter && accessMatch === null;
  // Convite pendente não tem permissões ainda: some nos filtros de permissão e fica só no filtro de grupo (os do grupo)
  const onlyGroupFilter = hasAccessFilter && !accessFilters.scope && !accessFilters.permission && !accessFilters.onlyDirect;
  const filteredUsers = users.filter((user) => {
    if (hasAccessFilter && !accessMatch?.has(user.id)) return false;
    if (!filter) return true;
    const haystack = `${user.name} ${user.email}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });
  const filteredInvites = invites.filter((invite) => {
    if (hasAccessFilter && !(onlyGroupFilter && invite.group_id === Number(accessFilters.groupId))) return false;
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
  const pagination = usePagination(rows, `${filter}|${accessFilterKey}`);

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
          <h2 className="settings-section-title">Pessoas, grupos e permissões</h2>
          <p className="settings-section-desc">
            Veja e cuide de quem são as pessoas, em quais grupos elas estão e o que cada uma pode fazer. Na visão{" "}
            <strong>Por membro</strong> você acrescenta permissões só para uma pessoa, além das que ela já recebe pelos
            grupos; na visão <strong>Por grupo</strong> você cria e cuida dos grupos e das permissões deles.
          </p>
        </div>
        {/* Um botao so, conforme a visao: adicionar membro na visao por membro, adicionar grupo na visao por grupo */}
        {view === "members" && canAddMember && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAddingMember(true)} style={{ whiteSpace: "nowrap" }}>
            + Adicionar membro
          </button>
        )}
        {view === "groups" && canCreateGroup && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreatingGroup(true)} style={{ whiteSpace: "nowrap" }}>
            + Adicionar grupo
          </button>
        )}
      </div>

      <div className="access-view-toggle" role="group" aria-label="Ver permissões">
        <button
          type="button"
          className={`btn btn-sm ${view === "members" ? "btn-secondary" : "btn-ghost"}`}
          aria-pressed={view === "members"}
          onClick={() => setView("members")}
        >
          Por membro
        </button>
        {canSeeGroups && (
          <button
            type="button"
            className={`btn btn-sm ${view === "groups" ? "btn-secondary" : "btn-ghost"}`}
            aria-pressed={view === "groups"}
            onClick={() => setView("groups")}
          >
            Por grupo
          </button>
        )}
      </div>

      {view === "groups" ? (
        <>
          <div className="table-search" style={{ marginBottom: 16, maxWidth: 360 }}>
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input
              className="input"
              type="search"
              placeholder="Filtrar grupos por nome..."
              aria-label="Filtrar grupos por nome"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <GroupsPermissionsView
            groups={groups}
            users={users}
            invites={invites}
            grants={groupGrants}
            filter={filter}
            onChanged={() => load().catch(() => undefined)}
            creating={creatingGroup}
            onCloseCreate={() => setCreatingGroup(false)}
          />
        </>
      ) : (
        <>
      <div className="access-report-filters" style={{ marginBottom: 6 }}>
        <div className="table-search access-report-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input
            className="input"
            type="search"
            placeholder="Filtrar por nome ou e-mail..."
            aria-label="Filtrar membros por nome ou e-mail"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <select
          className="input"
          aria-label="Filtrar por grupo"
          value={accessFilters.groupId}
          onChange={(e) => setAccessFilters((current) => ({ ...current, groupId: e.target.value }))}
        >
          <option value="">Todos os grupos</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>

        {catalog && (
          <>
            <select
              className="input"
              aria-label="Filtrar por coleção"
              value={accessFilters.scope}
              onChange={(e) => setAccessFilters((current) => ({ ...current, scope: e.target.value }))}
            >
              <option value="">Todas as coleções e o sistema todo</option>
              <option value="global">Só o sistema todo</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>

            <select
              className="input"
              aria-label="Filtrar por permissão"
              value={accessFilters.permission}
              onChange={(e) => setAccessFilters((current) => ({ ...current, permission: e.target.value }))}
            >
              <option value="">Todas as permissões</option>
              {[...new Set(catalog.permissions.map((p) => p.section))].map((section) => (
                <optgroup key={section} label={section}>
                  {catalog.permissions
                    .filter((p) => p.section === section)
                    .map((permission) => (
                      <option key={permission.key} value={permission.key}>
                        {permission.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>

            <label className="access-report-direct">
              <input
                type="checkbox"
                checked={accessFilters.onlyDirect}
                onChange={(e) => setAccessFilters((current) => ({ ...current, onlyDirect: e.target.checked }))}
              />
              Só quem tem permissão avulsa
            </label>
          </>
        )}

        {hasAccessFilter && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccessFilters(NO_ACCESS_FILTERS)}>
            Limpar filtros
          </button>
        )}
      </div>
      <p className="field-hint" style={{ marginBottom: 16 }}>
        “{defaultGroupName}” é o grupo padrão de todas as pessoas, por isso só aparece na coluna Grupos quando a pessoa
        não está em nenhum outro.
      </p>

      <div className="card data-table-card" style={{ overflow: "visible" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Grupos</th>
              <th>Permissões</th>
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
                      disabled={!canManageInvites || !canAddMember}
                    />
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    <span title="As permissões dos grupos valem quando a pessoa se cadastrar">Ao se cadastrar</span>
                  </td>
                  <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Aguardando cadastro</td>
                  <td style={{ width: 40 }}>
                    {(canManageInvites || (canAddMember && emailConfigured)) && (
                      <KebabMenu>
                        {(close) => (
                          <>
                            {canAddMember && emailConfigured && (
                              <button
                                type="button"
                                className="kebab-menu-item kebab-menu-item-with-icon"
                                onClick={() => {
                                  close();
                                  handleSendWelcomeEmail(row.email);
                                }}
                              >
                                <MenuIcon name="mail" />
                                Enviar e-mail de convite
                              </button>
                            )}
                            {canManageInvites && (
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
                          </>
                        )}
                      </KebabMenu>
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={row.user.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <UserAvatar name={row.user.name} pictureUrl={row.user.picture_url} />
                      {formatPersonName(row.user.name)}
                      {row.user.id === currentUser?.id && (
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>(você)</span>
                      )}
                      {row.user.is_blocked && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-danger, #c0392b)" }}>Bloqueado</span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>{row.user.email}</td>
                  <td>
                    <GroupsCell
                      user={row.user}
                      groups={groups}
                      onToggle={(group, checked) => handleToggle(row.user.id, group, checked)}
                      disabled={!canChangeGroups}
                    />
                  </td>
                  <td>
                    <MemberPermissionsBox summary={accessSummary.get(row.user.id)} />
                  </td>
                  <td style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {formatLastLogin(row.user.last_login, settings?.timezone)}
                  </td>
                  <td style={{ width: 40 }}>
                    <KebabMenu>
                      {(close) => (
                        <>
                          {canAddMember && emailConfigured && !row.user.is_blocked && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon"
                              onClick={() => {
                                close();
                                handleSendWelcomeEmail(row.user.email);
                              }}
                            >
                              <MenuIcon name="mail" />
                              Enviar e-mail de acesso
                            </button>
                          )}
                          {canResetPassword && emailConfigured && !row.user.is_blocked && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon"
                              onClick={() => {
                                close();
                                handleSendResetEmail(row.user);
                              }}
                            >
                              <MenuIcon name="forward_to_inbox" />
                              Enviar link de redefinição por e-mail
                            </button>
                          )}
                          {canResetPassword && (
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
                          )}
                          {canBlock && row.user.id !== currentUser?.id && (
                            <button
                              type="button"
                              className="kebab-menu-item kebab-menu-item-with-icon"
                              onClick={() => {
                                close();
                                if (row.user.is_blocked) handleBlock(row.user, false);
                                else setConfirmingBlockUser(row.user);
                              }}
                            >
                              <MenuIcon name={row.user.is_blocked ? "lock_open" : "block"} />
                              {row.user.is_blocked ? "Desbloquear" : "Bloquear"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="kebab-menu-item kebab-menu-item-with-icon"
                            onClick={() => {
                              close();
                              setEditingAccessUser(row.user);
                            }}
                          >
                            <MenuIcon name={canGivePermissions ? "edit" : "visibility"} />
                            {canGivePermissions ? "Editar" : "Ver permissões"}
                          </button>
                          {canRemoveMember && row.user.id !== currentUser?.id && (
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
                <td colSpan={6} style={{ color: "var(--color-text-muted)", textAlign: "center" }}>
                  {accessFilterLoading ? "Aplicando filtros..." : "Nenhum membro encontrado."}
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
        </>
      )}

      {addingMember && (
        <Modal title="Adicionar membro" wide onClose={closeAddMember}>
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

            {catalog && canGivePermissions && (
              <div className="field">
                <span>Permissões adicionais (opcional)</span>
                <span className="field-hint">
                  O que os grupos escolhidos dão já vale. Marque aqui só o que esta pessoa precisa a mais. Se ela ainda não
                  tiver conta, as permissões ficam guardadas no convite e valem quando ela se cadastrar.
                </span>
                <div className="access-editor">
                  <AccessForm
                    idPrefix="new-member"
                    catalog={catalog}
                    workspaces={workspaces}
                    draft={newMemberDraft}
                    onChange={setNewMemberDraft}
                    disabled={addingSaving}
                    allowed={access.holds}
                  />
                </div>
              </div>
            )}

            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                role="switch"
                checked={notifyByEmail && emailConfigured}
                onChange={(e) => setNotifyByEmail(e.target.checked)}
                disabled={!emailConfigured || addingSaving}
              />
              <span>Avisar a pessoa por e-mail, com o link para entrar</span>
            </label>
            {!emailConfigured && (
              <span className="field-hint">Para ligar, configure o servidor de e-mail em Configurações &gt; E-mail.</span>
            )}

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

      {editingAccessUser && (
        <Modal
          title="Editar membro"
          wide
          onClose={() => {
            setEditingAccessUser(null);
            // As permissões podem ter mudado: atualiza o resumo da coluna
            load().catch(() => undefined);
          }}
        >
          <AccessHero
            initials={initials(editingAccessUser.name)}
            pictureUrl={editingAccessUser.picture_url}
            name={formatPersonName(editingAccessUser.name)}
            subtitle={editingAccessUser.email}
            tagsLabel="Grupos"
            // O grupo padrão é de todo mundo: só aparece quando a pessoa não tem outro
            tags={(editingAccessUser.groups.some((g) => !g.is_default)
              ? editingAccessUser.groups.filter((g) => !g.is_default)
              : editingAccessUser.groups
            ).map((g) => g.name)}
            stats={[
              {
                label: "Permissões",
                value: accessSummary.get(editingAccessUser.id)?.isAdmin ? "Todas" : String(accessSummary.get(editingAccessUser.id)?.count ?? 0),
              },
              { label: "Avulsas", value: accessSummary.get(editingAccessUser.id)?.hasDirect ? "Sim" : "Não" },
              { label: "Último acesso", value: formatLastLogin(editingAccessUser.last_login, settings?.timezone) },
            ]}
          />
          <AccessEditor
            kind="user"
            id={editingAccessUser.id}
            intro="O que está marcado e travado vem dos grupos da pessoa e se muda no grupo. O que você marcar aqui vale só para esta pessoa e se soma ao que ela já recebe: nunca tira nada."
            onOpenGroups={
              canSeeGroups
                ? () => {
                    setEditingAccessUser(null);
                    setView("groups");
                  }
                : undefined
            }
            readOnly={!canGivePermissions}
            allowed={access.holds}
          />

          {accessSummary.get(editingAccessUser.id)?.isAdmin ? (
            <p className="access-intro">Administradores da plataforma nunca são limitados por horário de acesso.</p>
          ) : (
            <ScheduleEditor kind="user" id={editingAccessUser.id} readOnly={!access.can("membros.horario")} />
          )}
        </Modal>
      )}

      {confirmingRemoveUser && (
        <ConfirmDialog
          title="Remover membro"
          message={`Remover ${formatPersonName(confirmingRemoveUser.name)} do sistema? A conta, os grupos e os favoritos da pessoa são apagados. Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          onConfirm={() => {
            const userId = confirmingRemoveUser.id;
            setConfirmingRemoveUser(null);
            handleRemoveUser(userId);
          }}
          onCancel={() => setConfirmingRemoveUser(null)}
        />
      )}

      {confirmingBlockUser && (
        <ConfirmDialog
          title="Bloquear pessoa"
          message={`Bloquear ${formatPersonName(confirmingBlockUser.name)}? Ela não consegue mais entrar e a sessão aberta é encerrada na hora. Nada é apagado e dá para desbloquear depois.`}
          confirmLabel="Bloquear"
          onConfirm={() => {
            const user = confirmingBlockUser;
            setConfirmingBlockUser(null);
            handleBlock(user, true);
          }}
          onCancel={() => setConfirmingBlockUser(null)}
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
