"""Relatório de permissões: para cada pessoa e cada escopo (sistema todo ou uma coleção), o que ela pode
fazer e de onde vem cada permissão (qual grupo, ou dada direto à pessoa).

É só consulta. Usa a mesma regra do motor (core/access_engine.py): soma de grupos e permissões avulsas,
com "ver a coleção" e "ver os analíticos" implícitos. Quem é do grupo Administradores aparece numa linha
só, porque tem tudo em todo lugar."""

from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.core.access_catalog import CATALOG, GLOBAL, WORKSPACE, scope_of, with_implied
from app.models.access_grant import AccessGrant
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace

ADMIN_SCOPE_LABEL = "Todo o sistema e todas as coleções"
GLOBAL_SCOPE_LABEL = "Em todo o sistema"
NO_PERMISSION_LABEL = "Sem nenhuma permissão"

_LABELS = {p.key: p.label for p in CATALOG}
_ORDER = {p.key: index for index, p in enumerate(CATALOG)}


@dataclass
class Source:
    groups: set[str] = field(default_factory=set)
    direct: bool = False

    def merge(self, other: "Source") -> None:
        self.groups |= other.groups
        self.direct = self.direct or other.direct


@dataclass
class ReportGroup:
    name: str
    is_default: bool


@dataclass
class ReportPermission:
    key: str
    label: str
    groups: list[str]
    direct: bool


@dataclass
class ReportRow:
    user_id: int
    name: str
    email: str
    is_admin: bool
    groups: list[ReportGroup]
    workspace_id: int | None
    scope_label: str
    permissions: list[ReportPermission]


def _with_sources(raw: dict[str, Source]) -> list[ReportPermission]:
    """Permissões do escopo em ordem do catálogo. As implícitas herdam a origem de quem as pressupõe."""
    keys = with_implied(set(raw))
    everything = Source()
    for source in raw.values():
        everything.merge(source)
    result = []
    for key in sorted(keys, key=lambda k: _ORDER.get(k, 999)):
        source = raw.get(key) or everything
        result.append(
            ReportPermission(key=key, label=_LABELS.get(key, key), groups=sorted(source.groups), direct=source.direct)
        )
    return result


def build_report(
    db: Session,
    search: str = "",
    group_id: int | None = None,
    scope: str | None = None,
    permission: str | None = None,
    only_direct: bool = False,
    user_id: int | None = None,
) -> list[ReportRow]:
    """`scope` é "global" ou o id de uma coleção. `permission` é uma chave do catálogo. `only_direct` deixa só
    quem tem alguma permissão dada direto à pessoa. `user_id` deixa só uma pessoa."""
    users = db.query(User).order_by(User.name, User.email).all()
    groups = {g.id: g for g in db.query(Group).all()}
    workspaces = {w.id: w.name for w in db.query(Workspace.id, Workspace.name).all()}
    admin_group_ids = {g.id for g in groups.values() if g.is_admin_group}

    memberships: dict[int, set[int]] = {}
    for member in db.query(GroupMember.user_id, GroupMember.group_id).all():
        memberships.setdefault(member.user_id, set()).add(member.group_id)

    group_grants: dict[int, list[AccessGrant]] = {}
    user_grants: dict[int, list[AccessGrant]] = {}
    for grant in db.query(AccessGrant).all():
        if grant.group_id is not None:
            group_grants.setdefault(grant.group_id, []).append(grant)
        else:
            user_grants.setdefault(grant.user_id, []).append(grant)

    needle = search.strip().lower()
    scope_workspace = int(scope) if scope and scope != "global" else None
    rows: list[ReportRow] = []

    for user in users:
        if user_id is not None and user.id != user_id:
            continue
        if needle and needle not in user.name.lower() and needle not in user.email.lower():
            continue
        member_of = memberships.get(user.id, set())
        if group_id is not None and group_id not in member_of:
            continue
        user_groups = sorted(
            (ReportGroup(name=groups[g].name, is_default=groups[g].is_default) for g in member_of if g in groups),
            key=lambda item: item.name.lower(),
        )
        is_admin = bool(member_of & admin_group_ids)

        if is_admin:
            if only_direct:
                continue
            rows.append(
                ReportRow(
                    user_id=user.id,
                    name=user.name,
                    email=user.email,
                    is_admin=True,
                    groups=user_groups,
                    workspace_id=None,
                    scope_label=ADMIN_SCOPE_LABEL,
                    permissions=[],
                )
            )
            continue

        by_scope: dict[int | None, dict[str, Source]] = {}

        def add(grant: AccessGrant, source: Source) -> None:
            kind = scope_of(grant.permission_key)
            if kind == GLOBAL and grant.workspace_id is None:
                pass
            elif kind == WORKSPACE and grant.workspace_id is not None:
                pass
            else:
                return  # linha com escopo trocado: o motor também ignora
            by_scope.setdefault(grant.workspace_id, {}).setdefault(grant.permission_key, Source()).merge(source)

        for member_group in member_of:
            group = groups.get(member_group)
            if not group:
                continue
            for grant in group_grants.get(member_group, []):
                add(grant, Source(groups={group.name}))
        for grant in user_grants.get(user.id, []):
            add(grant, Source(direct=True))

        user_rows: list[ReportRow] = []
        ordered_scopes = sorted(by_scope, key=lambda wid: (wid is not None, workspaces.get(wid, "").lower() if wid else ""))
        for workspace_id in ordered_scopes:
            if workspace_id is not None and workspace_id not in workspaces:
                continue
            user_rows.append(
                ReportRow(
                    user_id=user.id,
                    name=user.name,
                    email=user.email,
                    is_admin=False,
                    groups=user_groups,
                    workspace_id=workspace_id,
                    scope_label=GLOBAL_SCOPE_LABEL if workspace_id is None else workspaces[workspace_id],
                    permissions=_with_sources(by_scope[workspace_id]),
                )
            )

        has_filter = bool(scope or permission or only_direct)
        if not user_rows and not has_filter:
            user_rows.append(
                ReportRow(
                    user_id=user.id,
                    name=user.name,
                    email=user.email,
                    is_admin=False,
                    groups=user_groups,
                    workspace_id=None,
                    scope_label=NO_PERMISSION_LABEL,
                    permissions=[],
                )
            )
        rows.extend(user_rows)

    return [row for row in rows if _matches(row, scope, scope_workspace, permission, only_direct)]


def _matches(row: ReportRow, scope: str | None, scope_workspace: int | None, permission: str | None, only_direct: bool) -> bool:
    if row.is_admin:
        # Administrador tem tudo em todo lugar: entra em qualquer filtro de escopo e de permissão
        return not only_direct
    if scope == "global" and row.workspace_id is not None:
        return False
    if scope_workspace is not None and row.workspace_id != scope_workspace:
        return False
    if permission and permission not in {p.key for p in row.permissions}:
        return False
    if only_direct and not any(p.direct for p in row.permissions):
        return False
    return True
