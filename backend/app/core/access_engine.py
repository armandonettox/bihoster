"""Calcula o que uma pessoa pode fazer, juntando grupos e permissoes dadas direto a ela.

Regra unica: permissao da pessoa = tudo que vem dos grupos dela + tudo que foi dado a ela, no escopo
pedido. So soma, nunca nega. Quem e do grupo Administradores tem todas, sem precisar de linhas.
Permissao nenhuma faz alguem virar administrador da plataforma: isso so vem de estar no grupo
Administradores (ver L-314)."""

from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.access_catalog import (
    COLLECTION_VIEW,
    GLOBAL,
    GLOBAL_KEYS,
    REPORT_CAPABLE,
    REPORT_VIEW,
    WORKSPACE,
    WORKSPACE_KEYS,
    scope_of,
    with_implied,
    with_implied_report,
)
from app.core.folder_tree import inherit_keys, load_parent_map
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.report_grant import ReportGrant
from app.models.workspace import GroupMember, Workspace


@dataclass
class EffectiveAccess:
    """Permissoes de uma pessoa: as globais e as de cada colecao (id da colecao para as chaves)."""

    is_admin: bool = False
    global_keys: set[str] = field(default_factory=set)
    by_workspace: dict[int, set[str]] = field(default_factory=dict)
    # O que foi dado direto a um relatorio (id do relatorio para as chaves), de grupos e da pessoa. Nao inclui o que ele
    # recebe da colecao: isso se soma em report_keys().
    by_report: dict[int, set[str]] = field(default_factory=dict)

    def has_global(self, key: str) -> bool:
        return self.is_admin or key in self.global_keys

    def has_in_workspace(self, key: str, workspace_id: int) -> bool:
        return self.is_admin or key in self.by_workspace.get(workspace_id, set())

    def workspace_ids_with(self, key: str) -> set[int]:
        return {wid for wid, keys in self.by_workspace.items() if key in keys}

    def report_keys(self, report_id: int, collection_id: int | None, also_in: Iterable[int] = ()) -> set[str]:
        """Tudo o que a pessoa pode num relatorio: o que foi dado direto nele somado ao que cada pasta em que ele
        aparece da para os relatorios (ver a pasta vale ver o relatorio; exportar, assinar... da pasta valem em cada
        relatorio dela). A colecao do relatorio e as pastas em que ele tambem aparece (`also_in`) valem igual, e as
        permissoes ja chegam com a heranca das pastas de cima. So soma. O administrador tem tudo."""
        keys = set(self.by_report.get(report_id, ()))
        folders = ([collection_id] if collection_id is not None else []) + list(also_in)
        for folder in folders:
            from_folder = self.by_workspace.get(folder, set())
            keys |= {key for key in from_folder if key in REPORT_CAPABLE}
            if COLLECTION_VIEW in from_folder:
                keys.add(REPORT_VIEW)
        return keys

    def has_in_report(self, key: str, report_id: int, collection_id: int | None, also_in: Iterable[int] = ()) -> bool:
        return self.is_admin or key in self.report_keys(report_id, collection_id, also_in)

    def reports_with(self, key: str) -> set[int]:
        """Relatorios em que a pessoa tem o item por concessao direta (nao inclui o que vem da colecao)."""
        return {rid for rid, keys in self.by_report.items() if key in keys}


def effective_access(db: Session, user_id: int) -> EffectiveAccess:
    """Todas as permissoes da pessoa, em duas consultas. Administrador recebe tudo."""
    if is_platform_admin(db, user_id):
        # A Raiz (colecao interna do catalogo) nao entra: nao aparece como colecao em nenhuma lista
        workspace_ids = [row.id for row in db.query(Workspace.id).filter(Workspace.system_key.is_(None)).all()]
        return EffectiveAccess(
            is_admin=True,
            global_keys=set(GLOBAL_KEYS),
            by_workspace={wid: set(WORKSPACE_KEYS) for wid in workspace_ids},
        )

    from_groups = (
        db.query(AccessGrant.workspace_id, AccessGrant.permission_key)
        .join(GroupMember, GroupMember.group_id == AccessGrant.group_id)
        .filter(GroupMember.user_id == user_id)
        .all()
    )
    from_user = (
        db.query(AccessGrant.workspace_id, AccessGrant.permission_key)
        .filter(AccessGrant.user_id == user_id)
        .all()
    )

    result = EffectiveAccess()
    raw_global: set[str] = set()
    raw_workspace: dict[int, set[str]] = {}
    for workspace_id, key in [*from_groups, *from_user]:
        scope = scope_of(key)
        if scope == GLOBAL and workspace_id is None:
            raw_global.add(key)
        elif scope == WORKSPACE and workspace_id is not None:
            raw_workspace.setdefault(workspace_id, set()).add(key)
        # linha com escopo trocado (chave de colecao sem colecao, por exemplo) e ignorada

    result.global_keys = set(with_implied(raw_global))
    result.by_workspace = {wid: set(with_implied(keys)) for wid, keys in raw_workspace.items()}
    # Uma pasta passa o que tem para as de dentro dela (so soma)
    result.by_workspace = inherit_keys(result.by_workspace, load_parent_map(db) if result.by_workspace else {})

    # Concessoes dadas direto a relatorios (uma consulta so: da pessoa ou de qualquer grupo dela)
    my_groups = db.query(GroupMember.group_id).filter(GroupMember.user_id == user_id)
    raw_report: dict[int, set[str]] = {}
    for report_id, key in (
        db.query(ReportGrant.report_id, ReportGrant.permission_key)
        .filter(or_(ReportGrant.user_id == user_id, ReportGrant.group_id.in_(my_groups)))
        .all()
    ):
        if key in REPORT_CAPABLE:  # linha com item que nao vale num relatorio e ignorada
            raw_report.setdefault(report_id, set()).add(key)
    result.by_report = {rid: set(with_implied_report(keys)) for rid, keys in raw_report.items()}
    return result


def can_in_workspace(db: Session, user_id: int, key: str, workspace_id: int) -> bool:
    return effective_access(db, user_id).has_in_workspace(key, workspace_id)


def can_global(db: Session, user_id: int, key: str) -> bool:
    return effective_access(db, user_id).has_global(key)


def folders_of_report(db: Session, report_id: int) -> list[int]:
    """As pastas em que o relatorio TAMBEM aparece (alem da colecao dele)."""
    from app.models.report_grant import ReportCollection

    return [row[0] for row in db.query(ReportCollection.collection_id).filter(ReportCollection.report_id == report_id).all()]


def can_in_report(db: Session, user_id: int, key: str, report) -> bool:
    """`report` e a linha de Report (precisa de id e collection_id)."""
    return effective_access(db, user_id).has_in_report(key, report.id, report.collection_id, folders_of_report(db, report.id))


def can_see_workspace(db: Session, user_id: int, workspace_id: int) -> bool:
    return can_in_workspace(db, user_id, COLLECTION_VIEW, workspace_id)
