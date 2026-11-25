"""Acesso por relatorio: dar, tirar e conferir o que grupos e pessoas podem em cada relatorio.

Quem mexe: o administrador, quem tem a permissao geral `permissoes.editar` ou quem recebeu "compartilhar" no relatorio,
sempre so com o que ja tem nele (core/report_access.py). O que cada pessoa recebe e a soma do que foi dado no relatorio
com o que a colecao dele da (core/access_engine.py)."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_catalog import COLLECTION_VIEW, REPORT_CAPABLE, REPORT_VIEW
from app.core.access_deps import require_any_global_permission
from app.core.access_engine import effective_access, folders_of_report
from app.core.folder_tree import ancestors, descendants, load_parent_map
from app.core.audit import log_action
from app.core.database import get_db
from app.core.report_access import (
    GROUP,
    USER,
    can_manage,
    check_can_change,
    collection_name_for_audit,
    require_can_manage,
    set_subject_keys,
    subject_keys,
    validate_keys,
    with_dependents,
)
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.invite import GroupInvite
from app.models.report import Report
from app.models.report_grant import ReportCollection, ReportGrant, ReportInviteGrant
from app.models.user import User
from app.models.workspace import Group, GroupMember, Workspace
from app.routers.auth import get_current_user

router = APIRouter(prefix="/report-access", tags=["report-access"])

MAX_BULK_REPORTS = 200
MAX_PAGE_SIZE = 100
PERSON_LIMIT = 2000

# Quem ve a lista de grupos e pessoas dos acessos: o mesmo que ja ve em Gerenciar usuarios
_can_list = require_any_global_permission("membros.ver", "grupos.ver", "permissoes.editar")

PRESETS: dict[str, tuple[str, ...]] = {
    "leitor": (REPORT_VIEW,),
    "leitor-exportador": (REPORT_VIEW, "relatorio.exportar"),
}


class PermissionItem(BaseModel):
    key: str
    label: str
    description: str
    feature: Optional[str] = None
    feature_label: Optional[str] = None
    requires: list[str]


class ReportCatalogOut(BaseModel):
    permissions: list[PermissionItem]
    presets: dict[str, list[str]]


class KeysIn(BaseModel):
    permissions: list[str] = Field(default_factory=list, max_length=60)


class SubjectOut(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    is_admin_group: bool = False
    permissions: list[str]
    # So nos grupos: o que o grupo recebe pela colecao do relatorio (soma-se ao que foi dado direto)
    from_collection: list[str] = []


class ReportRef(BaseModel):
    id: int
    name: str
    collection_id: int
    collection_name: str
    in_root: bool


class ReportAccessOut(BaseModel):
    report: ReportRef
    groups: list[SubjectOut]
    users: list[SubjectOut]
    can_manage: bool


class BulkIn(BaseModel):
    report_ids: list[int] = Field(min_length=1, max_length=MAX_BULK_REPORTS)
    group_ids: list[int] = Field(default_factory=list, max_length=100)
    user_ids: list[int] = Field(default_factory=list, max_length=100)
    permissions: list[str] = Field(min_length=1, max_length=60)
    mode: Literal["add", "remove"] = "add"

    @field_validator("report_ids", "group_ids", "user_ids")
    @classmethod
    def unique_ids(cls, value: list[int]) -> list[int]:
        return list(dict.fromkeys(value))


class BulkOut(BaseModel):
    reports: int
    subjects: int
    changes: int


class ByEmailIn(BaseModel):
    email: EmailStr
    report_ids: list[int] = Field(min_length=1, max_length=MAX_BULK_REPORTS)
    permissions: list[str] = Field(min_length=1, max_length=60)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


def _report_or_404(db: Session, report_id: int) -> Report:
    report = db.query(Report).get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    return report


def _ref(report: Report, collection: Workspace) -> ReportRef:
    return ReportRef(id=report.id, name=report.name, collection_id=collection.id, collection_name=collection.name, in_root=collection.system_key is not None)


def _audit(db: Session, actor: User, report: Report, details: str) -> None:
    log_action(
        db,
        action="update",
        entity="report_access",
        user_id=actor.id,
        workspace_id=collection_name_for_audit(db, report),
        entity_id=str(report.id),
        details=details[:300],
    )


def _links_of(db: Session, report_ids: list[int]) -> dict[int, list[int]]:
    """As pastas em que cada relatorio tambem aparece (alem da colecao dele)."""
    result: dict[int, list[int]] = {}
    if not report_ids:
        return result
    for report_id, folder_id in db.query(ReportCollection.report_id, ReportCollection.collection_id).filter(ReportCollection.report_id.in_(report_ids)):
        result.setdefault(report_id, []).append(folder_id)
    return result


def _folder_inherited(keys_by_folder: dict[int, set[str]], folders: list[int], parents: dict) -> set[str]:
    """O que um grupo recebe num relatorio pelas pastas dele: o dado a cada pasta e a cada pasta de cima dela (a heranca),
    so os itens que valem num relatorio, e "ver a pasta" vira "ver o relatorio"."""
    inherited: set[str] = set()
    for folder in folders:
        keys: set[str] = set()
        for source in [folder, *ancestors(parents, folder)]:
            keys |= keys_by_folder.get(source, set())
        inherited |= {key for key in keys if key in REPORT_CAPABLE}
        if COLLECTION_VIEW in keys:
            inherited.add(REPORT_VIEW)
    return inherited


def _collection_keys_of_group(db: Session, group_id: int, collection_id: int, also_in: list[int] | None = None) -> set[str]:
    keys_by_folder: dict[int, set[str]] = {}
    for workspace_id, key in db.query(AccessGrant.workspace_id, AccessGrant.permission_key).filter(AccessGrant.group_id == group_id, AccessGrant.workspace_id.isnot(None)):
        keys_by_folder.setdefault(workspace_id, set()).add(key)
    return _folder_inherited(keys_by_folder, [collection_id, *(also_in or [])], load_parent_map(db))


def _diff_text(before: set[str], after: set[str]) -> str:
    return f"+{len(after - before)} -{len(before - after)}"


# As rotas fixas vem antes das com {report_id}: senao o caminho fixo seria lido como um numero


@router.get("/catalog", response_model=ReportCatalogOut)
def report_catalog(_: User = Depends(get_current_user)):
    """Os itens que podem ser dados so num relatorio, com o que cada um exige (ver o relatorio, no lugar de ver a colecao)."""
    items = []
    for permission in access_catalog.CATALOG:
        if permission.key not in REPORT_CAPABLE:
            continue
        items.append(
            PermissionItem(
                key=permission.key,
                label=permission.label,
                description=permission.description,
                feature=permission.feature,
                feature_label=permission.feature_label,
                requires=list(access_catalog.report_requires(permission.key)),
            )
        )
    return ReportCatalogOut(permissions=items, presets={name: list(keys) for name, keys in PRESETS.items()})


class SharedReportOut(BaseModel):
    id: int
    name: str
    collection_id: int
    collection_name: str
    in_root: bool
    thumbnail_url: Optional[str] = None
    display_type: str


@router.get("/shared-with-me", response_model=list[SharedReportOut])
def shared_with_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Os relatorios que a pessoa recebeu direto (por ela ou por um grupo) e que ela nao ve pela colecao: e por onde
    ela os encontra, ja que nao entra na colecao inteira."""
    access = effective_access(db, current_user.id)
    if access.is_admin:
        return []
    ids = access.reports_with(REPORT_VIEW)
    if not ids:
        return []
    rows = (
        db.query(Report, Workspace)
        .join(Workspace, Workspace.id == Report.collection_id)
        .filter(Report.id.in_(ids))
        .order_by(Report.name, Report.id)
        .all()
    )
    links = _links_of(db, [report.id for report, _ in rows])
    result = []
    for report, collection in rows:
        if any(COLLECTION_VIEW in access.by_workspace.get(folder, set()) for folder in [collection.id, *links.get(report.id, [])]):
            continue  # ja aparece em uma pasta que a pessoa ve
        result.append(
            SharedReportOut(
                id=report.id,
                name=report.name,
                collection_id=collection.id,
                collection_name=collection.name,
                in_root=collection.system_key is not None,
                thumbnail_url=report.thumbnail_url,
                display_type=report.display_type,
            )
        )
    return result


class ImpactOut(BaseModel):
    reports: int
    in_root: bool


@router.get("/impact/collections/{workspace_id}", response_model=ImpactOut)
def collection_impact(workspace_id: int, db: Session = Depends(get_db), _: User = Depends(_can_list)):
    """Quantos relatorios uma permissao dada a uma colecao libera: a tela mostra o aviso antes de conceder."""
    workspace = db.query(Workspace).get(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")
    # A permissao de uma pasta vale tambem nas de dentro dela (heranca) e nos relatorios que aparecem nelas por vinculo
    folders = {workspace_id} | descendants(load_parent_map(db), workspace_id)
    own = {row[0] for row in db.query(Report.id).filter(Report.collection_id.in_(folders))}
    linked = {row[0] for row in db.query(ReportCollection.report_id).filter(ReportCollection.collection_id.in_(folders))}
    return ImpactOut(reports=len(own | linked), in_root=workspace.system_key is not None)


class MatrixCell(BaseModel):
    direct: list[str]
    inherited: list[str]


class MatrixRow(BaseModel):
    report: ReportRef
    cells: dict[int, MatrixCell]


class MatrixGroup(BaseModel):
    id: int
    name: str


class MatrixOut(BaseModel):
    groups: list[MatrixGroup]
    rows: list[MatrixRow]
    total: int
    page: int
    page_size: int


@router.get("/matrix", response_model=MatrixOut)
def matrix(
    search: str = "",
    where: Literal["all", "root", "collections"] = "all",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    _: User = Depends(_can_list),
):
    """Relatorio por grupo: o que cada grupo tem em cada relatorio, direto e pela colecao."""
    query = db.query(Report, Workspace).join(Workspace, Workspace.id == Report.collection_id)
    if search.strip():
        like = "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(or_(Report.name.ilike(like, escape="\\"), Report.pbi_workspace_name.ilike(like, escape="\\"), Workspace.name.ilike(like, escape="\\")))
    if where == "root":
        query = query.filter(Workspace.system_key.isnot(None))
    elif where == "collections":
        query = query.filter(Workspace.system_key.is_(None))
    total = query.count()
    page_rows = query.order_by(Report.name, Report.id).offset((page - 1) * page_size).limit(page_size).all()

    groups = db.query(Group).filter(Group.is_admin_group.is_(False)).order_by(Group.name).all()
    group_ids = [g.id for g in groups]
    report_ids = [report.id for report, _ in page_rows]
    collection_ids = {collection.id for _, collection in page_rows}

    direct: dict[tuple[int, int], set[str]] = {}
    if report_ids and group_ids:
        for report_id, group_id, key in db.query(ReportGrant.report_id, ReportGrant.group_id, ReportGrant.permission_key).filter(
            ReportGrant.report_id.in_(report_ids), ReportGrant.group_id.in_(group_ids)
        ):
            direct.setdefault((report_id, group_id), set()).add(key)
    parents = load_parent_map(db)
    links = _links_of(db, report_ids)
    # Pastas que contam para cada relatorio: a colecao dele, as outras em que aparece e as de cima de todas elas
    relevant = set(collection_ids)
    for folders in links.values():
        relevant.update(folders)
    for folder in list(relevant):
        relevant.update(ancestors(parents, folder))
    by_group_folder: dict[int, dict[int, set[str]]] = {}
    if relevant and group_ids:
        for group_id, folder_id, key in db.query(AccessGrant.group_id, AccessGrant.workspace_id, AccessGrant.permission_key).filter(
            AccessGrant.workspace_id.in_(relevant), AccessGrant.group_id.in_(group_ids)
        ):
            by_group_folder.setdefault(group_id, {}).setdefault(folder_id, set()).add(key)

    rows = []
    for report, collection in page_rows:
        cells = {}
        folders = [collection.id, *links.get(report.id, [])]
        for group in groups:
            inherited = _folder_inherited(by_group_folder.get(group.id, {}), folders, parents)
            cells[group.id] = MatrixCell(direct=sorted(direct.get((report.id, group.id), set())), inherited=sorted(inherited))
        rows.append(MatrixRow(report=_ref(report, collection), cells=cells))
    return MatrixOut(groups=[MatrixGroup(id=g.id, name=g.name) for g in groups], rows=rows, total=total, page=page, page_size=page_size)


class PersonRow(BaseModel):
    report: ReportRef
    permissions: list[str]
    sources: list[str]


class PersonOut(BaseModel):
    user_id: int
    name: str
    is_admin: bool
    rows: list[PersonRow]
    truncated: bool


@router.get("/person/{user_id}", response_model=PersonOut)
def person(user_id: int, db: Session = Depends(get_db), _: User = Depends(_can_list)):
    """O que esta pessoa ve e por que: cada relatorio que ela abre, com a origem (direto, por grupo ou pela colecao)."""
    target = db.query(User).get(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Pessoa nao encontrada")
    if is_platform_admin(db, user_id):
        return PersonOut(user_id=user_id, name=target.name, is_admin=True, rows=[], truncated=False)

    access = effective_access(db, user_id)
    my_groups = {gm.group_id: name for gm, name in db.query(GroupMember, Group.name).join(Group, Group.id == GroupMember.group_id).filter(GroupMember.user_id == user_id).all()}
    sources: dict[int, set[str]] = {}
    for report_id, group_id, subject_user_id in db.query(ReportGrant.report_id, ReportGrant.group_id, ReportGrant.user_id).filter(
        or_(ReportGrant.user_id == user_id, ReportGrant.group_id.in_(list(my_groups) or [-1]))
    ):
        sources.setdefault(report_id, set()).add("Direto na pessoa" if subject_user_id == user_id else f"Grupo {my_groups.get(group_id, group_id)}")

    visible_collections = {cid for cid, keys in access.by_workspace.items() if COLLECTION_VIEW in keys}
    report_ids = set(sources)
    linked_ids = {row[0] for row in db.query(ReportCollection.report_id).filter(ReportCollection.collection_id.in_(visible_collections or [-1]))}
    query = db.query(Report, Workspace).join(Workspace, Workspace.id == Report.collection_id)
    query = query.filter(or_(Report.id.in_((report_ids | linked_ids) or [-1]), Report.collection_id.in_(visible_collections or [-1])))
    found = query.order_by(Report.name, Report.id).limit(PERSON_LIMIT + 1).all()
    truncated = len(found) > PERSON_LIMIT
    links = _links_of(db, [report.id for report, _ in found[:PERSON_LIMIT]])
    folder_names = {w.id: w.name for w in db.query(Workspace.id, Workspace.name).all()}
    rows = []
    for report, collection in found[:PERSON_LIMIT]:
        folders = [collection.id, *links.get(report.id, [])]
        keys = access.report_keys(report.id, report.collection_id, links.get(report.id, []))
        if REPORT_VIEW not in keys:
            continue
        origin = set(sources.get(report.id, set()))
        for folder in folders:
            if folder in access.by_workspace:
                origin.add(f"Coleção {folder_names.get(folder, folder)}")
        rows.append(PersonRow(report=_ref(report, collection), permissions=sorted(keys), sources=sorted(origin)))
    return PersonOut(user_id=user_id, name=target.name, is_admin=False, rows=rows, truncated=truncated)


@router.post("/bulk", response_model=BulkOut)
def bulk(data: BulkIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Da (ou tira) as mesmas permissoes de varios relatorios a varios grupos e pessoas de uma vez."""
    if not data.group_ids and not data.user_ids:
        raise HTTPException(status_code=422, detail="Escolha ao menos um grupo ou uma pessoa")
    keys = set(validate_keys(data.permissions)) if data.mode == "add" else with_dependents(set(data.permissions) & REPORT_CAPABLE)
    if data.mode == "remove" and not keys:
        raise HTTPException(status_code=422, detail="Permissao que nao vale num relatorio")
    reports = db.query(Report).filter(Report.id.in_(data.report_ids)).all()
    if len(reports) != len(data.report_ids):
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    groups = db.query(Group).filter(Group.id.in_(data.group_ids)).all() if data.group_ids else []
    users = db.query(User).filter(User.id.in_(data.user_ids)).all() if data.user_ids else []
    if len(groups) != len(data.group_ids) or len(users) != len(data.user_ids):
        raise HTTPException(status_code=404, detail="Grupo ou pessoa nao encontrado")
    if any(group.is_admin_group for group in groups) or any(is_platform_admin(db, user.id) for user in users):
        raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a todos os relatorios")

    # Confere tudo antes de gravar qualquer coisa: o pedido inteiro entra ou nenhum
    plan = []
    for report in reports:
        access = require_can_manage(db, current_user, report)
        check_can_change(access, report, keys, folders_of_report(db, report.id))
        for subject, subject_id in [(GROUP, g.id) for g in groups] + [(USER, u.id) for u in users]:
            before = subject_keys(db, report.id, subject, subject_id)
            after = (before | keys) if data.mode == "add" else (before - keys)
            plan.append((report, subject, subject_id, before, after))

    changes = 0
    for report, subject, subject_id, before, after in plan:
        if before != after:
            set_subject_keys(db, report.id, subject, subject_id, after)
            changes += 1
    db.commit()
    log_action(
        db,
        action="update",
        entity="report_access",
        user_id=current_user.id,
        details=f"{'dar' if data.mode == 'add' else 'tirar'} {len(keys)} permissoes: {len(reports)} relatorios, {len(groups)} grupos, {len(users)} pessoas",
    )
    return BulkOut(reports=len(reports), subjects=len(groups) + len(users), changes=changes)


@router.post("/by-email")
def grant_by_email(data: ByEmailIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Convida por e-mail ja com acesso a relatorios: se a pessoa tem conta, recebe na hora; se ainda nao tem, fica
    reservado no convite que ja existe para o e-mail (sem convite pendente nao reserva nada)."""
    keys = set(validate_keys(data.permissions))
    reports = db.query(Report).filter(Report.id.in_(data.report_ids)).all()
    if len(reports) != len(set(data.report_ids)):
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    for report in reports:
        check_can_change(require_can_manage(db, current_user, report), report, keys, folders_of_report(db, report.id))

    user = db.query(User).filter(User.email == data.email).first()
    if user is not None:
        if is_platform_admin(db, user.id):
            raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a todos os relatorios")
        for report in reports:
            set_subject_keys(db, report.id, USER, user.id, subject_keys(db, report.id, USER, user.id) | keys)
        db.commit()
        log_action(db, action="update", entity="report_access", user_id=current_user.id, entity_id=str(user.id), details=f"{user.email}: {len(reports)} relatorios")
        return {"status": "applied"}

    if db.query(GroupInvite.id).filter(GroupInvite.email == data.email).first() is None:
        raise HTTPException(status_code=400, detail="Convide a pessoa antes de reservar acesso a relatorios para ela")
    db.query(ReportInviteGrant).filter(ReportInviteGrant.email == data.email, ReportInviteGrant.report_id.in_([r.id for r in reports])).delete(synchronize_session=False)
    for report in reports:
        for key in sorted(keys):
            db.add(ReportInviteGrant(email=data.email, report_id=report.id, permission_key=key))
    db.commit()
    log_action(db, action="update", entity="report_access", user_id=current_user.id, details=f"{data.email} (convite): {len(reports)} relatorios")
    return {"status": "pending"}


@router.get("/{report_id}", response_model=ReportAccessOut)
def get_report_access(report_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    report = _report_or_404(db, report_id)
    access = require_can_manage(db, current_user, report)
    collection = db.query(Workspace).get(report.collection_id)
    group_rows = {
        (row.group_id): set()
        for row in db.query(ReportGrant.group_id).filter(ReportGrant.report_id == report_id, ReportGrant.group_id.isnot(None)).distinct()
    }
    for gid, key in db.query(ReportGrant.group_id, ReportGrant.permission_key).filter(ReportGrant.report_id == report_id, ReportGrant.group_id.isnot(None)):
        group_rows.setdefault(gid, set()).add(key)
    user_rows: dict[int, set[str]] = {}
    for uid, key in db.query(ReportGrant.user_id, ReportGrant.permission_key).filter(ReportGrant.report_id == report_id, ReportGrant.user_id.isnot(None)):
        user_rows.setdefault(uid, set()).add(key)

    groups = db.query(Group).filter(Group.is_admin_group.is_(False)).order_by(Group.name).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_(list(user_rows) or [-1])).all()}
    return ReportAccessOut(
        report=_ref(report, collection),
        groups=[
            SubjectOut(
                id=g.id,
                name=g.name,
                permissions=sorted(group_rows.get(g.id, set())),
                from_collection=sorted(_collection_keys_of_group(db, g.id, report.collection_id, folders_of_report(db, report.id))),
            )
            for g in groups
        ],
        users=[SubjectOut(id=uid, name=users[uid].name, email=users[uid].email, permissions=sorted(keys)) for uid, keys in sorted(user_rows.items()) if uid in users],
        can_manage=can_manage(access, report, folders_of_report(db, report.id)),
    )


def _put_subject(db: Session, actor: User, report: Report, subject: str, subject_id: int, keys_in: list[str]) -> tuple[set[str], set[str]]:
    access = require_can_manage(db, actor, report)
    after = set(validate_keys(keys_in)) if keys_in else set()
    before = subject_keys(db, report.id, subject, subject_id)
    check_can_change(access, report, before ^ after, folders_of_report(db, report.id))
    set_subject_keys(db, report.id, subject, subject_id, after)
    db.commit()
    return before, after


@router.put("/{report_id}/groups/{group_id}")
def put_group(report_id: int, group_id: int, data: KeysIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    report = _report_or_404(db, report_id)
    group = db.query(Group).get(group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if group.is_admin_group:
        raise HTTPException(status_code=400, detail="O grupo Administradores ja tem acesso a todos os relatorios")
    before, after = _put_subject(db, current_user, report, GROUP, group_id, data.permissions)
    _audit(db, current_user, report, f"{report.name}, grupo {group.name}: {_diff_text(before, after)}")
    return {"permissions": sorted(after)}


@router.put("/{report_id}/users/{user_id}")
def put_user(report_id: int, user_id: int, data: KeysIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    report = _report_or_404(db, report_id)
    target = db.query(User).get(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Pessoa nao encontrada")
    if is_platform_admin(db, user_id):
        raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a todos os relatorios")
    before, after = _put_subject(db, current_user, report, USER, user_id, data.permissions)
    _audit(db, current_user, report, f"{report.name}, {target.email}: {_diff_text(before, after)}")
    return {"permissions": sorted(after)}
