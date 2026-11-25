"""Painel "Gerenciar permissoes" de um relatorio ou de um modelo semantico, no estilo do Power BI Service: a lista de quem tem
acesso (pessoas e grupos, com o preset e a ORIGEM de cada acesso), um campo so para adicionar pessoas ou grupos e, para um
e-mail sem conta, o convite.

Os dados sao os MESMOS das telas de Gerenciar usuarios (report_grants e dataset_grants, mais o que as colecoes dao): nao ha
uma segunda fonte. Quem mexe: o administrador, quem tem `permissoes.editar` ou quem recebeu "compartilhar" no item, sempre so
com o que ja tem nele."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core import access_catalog, connection_access, dataset_access, report_access
from app.core.access_catalog import COLLECTION_VIEW, CONNECTION_CAPABLE, DATASET_CAPABLE, REPORT_CAPABLE, REPORT_VIEW
from app.core.access_engine import effective_access, folders_of_report
from app.core.access_presets import LABELS, PRESETS, preset_of
from app.core.audit import log_action
from app.core.database import get_db
from app.core.folder_tree import ancestors, load_parent_map
from app.core.workspace_deps import get_or_create_default_group, is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.catalog_sync import PbiDataset
from app.models.connection_grant import ConnectionGrant
from app.models.powerbi_connection import PowerBIConnection
from app.models.dataset_grant import DatasetGrant, DatasetInviteGrant
from app.models.invite import GroupInvite
from app.models.report import Report
from app.models.report_grant import ReportGrant, ReportInviteGrant
from app.models.user import User
from app.models.workspace import Group, Workspace
from app.routers.auth import get_current_user

router = APIRouter(prefix="/access-panel", tags=["access-panel"])

Kind = Literal["report", "dataset", "connection"]
SubjectKind = Literal["user", "group"]
MAX_SUBJECTS = 20


class SubjectOut(BaseModel):
    kind: SubjectKind
    id: int
    name: str
    email: Optional[str] = None
    picture_url: Optional[str] = None


class Origin(BaseModel):
    # direct = dado neste item; folder = vem de uma pasta; inherited = vem de uma pasta de cima
    kind: Literal["direct", "folder", "inherited"]
    label: str


class Entry(BaseModel):
    subject_kind: SubjectKind
    subject_id: int
    name: str
    email: Optional[str] = None
    picture_url: Optional[str] = None
    # Itens dados direto neste item (e o que o usuario edita); o que vem de pastas nao entra aqui
    permissions: list[str]
    # O que a pessoa ou grupo pode ao todo neste item (direto mais pastas), so para mostrar
    effective: list[str]
    preset: Optional[str] = None
    origins: list[Origin]


class PresetOut(BaseModel):
    key: str
    label: str
    permissions: list[str]


class ItemRef(BaseModel):
    kind: Kind
    id: int
    name: str
    subtitle: Optional[str] = None


class PermissionItem(BaseModel):
    key: str
    label: str
    description: str


class PanelOut(BaseModel):
    item: ItemRef
    entries: list[Entry]
    presets: list[PresetOut]
    permissions: list[PermissionItem]
    can_manage: bool


class PutIn(BaseModel):
    # Um preset (ver, exportar, atualizar, gerenciar) ou a lista de itens; vazio remove o acesso direto
    preset: Optional[str] = None
    permissions: Optional[list[str]] = Field(default=None, max_length=60)


class InviteIn(BaseModel):
    email: EmailStr
    preset: Optional[str] = None
    permissions: Optional[list[str]] = Field(default=None, max_length=60)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


def _mod(kind: Kind):
    """O modulo que grava e confere o acesso de cada tipo de item."""
    return {"report": report_access, "dataset": dataset_access, "connection": connection_access}[kind]


def _capable(kind: Kind) -> frozenset[str]:
    return {"report": REPORT_CAPABLE, "dataset": DATASET_CAPABLE, "connection": CONNECTION_CAPABLE}[kind]


def _item(db: Session, kind: Kind, item_id: int):
    if kind == "report":
        item = db.query(Report).get(item_id)
    elif kind == "connection":
        item = db.query(PowerBIConnection).get(item_id)
    else:
        item = db.query(PbiDataset).get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item nao encontrado")
    return item


def _keys_for(kind: Kind, preset: Optional[str], permissions: Optional[list[str]]) -> list[str]:
    if preset is not None:
        if preset not in PRESETS[kind]:
            raise HTTPException(status_code=422, detail="Preset desconhecido")
        return list(PRESETS[kind][preset])
    return list(permissions or [])


def _require_manage(db: Session, user: User, kind: Kind, item):
    return _mod(kind).require_can_manage(db, user, item)


def _grants(db: Session, kind: Kind, item_id: int) -> list[tuple[Optional[int], Optional[int], str]]:
    model, column = {
        "report": (ReportGrant, ReportGrant.report_id),
        "dataset": (DatasetGrant, DatasetGrant.dataset_id),
        "connection": (ConnectionGrant, ConnectionGrant.connection_id),
    }[kind]
    return [(row[0], row[1], row[2]) for row in db.query(model.user_id, model.group_id, model.permission_key).filter(column == item_id)]


@router.get("/subjects", response_model=list[SubjectOut])
def search_subjects(q: str = Query("", max_length=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Autocompletar do campo "Adicionar pessoas ou grupos": ate 20 pessoas e grupos que casam com o texto. So para quem
    pode compartilhar alguma coisa."""
    access = effective_access(db, current_user.id)
    allowed = (
        access.is_admin
        or any(access.has_global(key) for key in ("permissoes.editar", "membros.ver", "grupos.ver"))
        or any(access.has_in_report("relatorio.compartilhar", rid, None) for rid in access.by_report)
        or any(access.has_in_dataset("modelo.compartilhar", did) for did in access.by_dataset)
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Voce nao pode compartilhar nada")
    needle = q.strip()
    if not needle:
        return []
    like = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    users = (
        db.query(User)
        .filter(or_(User.name.ilike(like, escape="\\"), User.email.ilike(like, escape="\\")), or_(User.is_blocked.is_(None), User.is_blocked.is_(False)))
        .order_by(User.name)
        .limit(MAX_SUBJECTS)
        .all()
    )
    groups = db.query(Group).filter(Group.name.ilike(like, escape="\\"), Group.is_admin_group.is_(False)).order_by(Group.name).limit(MAX_SUBJECTS).all()
    result = [SubjectOut(kind="group", id=g.id, name=g.name) for g in groups]
    result += [SubjectOut(kind="user", id=u.id, name=u.name, email=u.email, picture_url=u.picture_url) for u in users]
    return result[:MAX_SUBJECTS]


class KindCatalog(BaseModel):
    presets: list[PresetOut]
    permissions: list[PermissionItem]


# Declarada ANTES de /{kind}/{item_id}: senao "catalog" seria lido como o tipo do item
@router.get("/catalog/{kind}", response_model=KindCatalog)
def kind_catalog(kind: Kind, _: User = Depends(get_current_user)):
    """Os presets e os itens de permissao de um tipo (relatorio ou modelo), para as telas montarem "Personalizar"."""
    capable = _capable(kind)
    return KindCatalog(
        presets=[PresetOut(key=key, label=LABELS[kind][key], permissions=list(keys)) for key, keys in PRESETS[kind].items()],
        permissions=[PermissionItem(key=p.key, label=p.label, description=p.description) for p in access_catalog.CATALOG if p.key in capable],
    )


def _folder_origins(db: Session, report: Report) -> dict[tuple[str, int], tuple[set[str], list[Origin]]]:
    """Quem recebe acesso a este relatorio pelas pastas dele (e pelas de cima): para cada pessoa ou grupo, os itens e a origem."""
    parents = load_parent_map(db)
    names = {w.id: w.name for w in db.query(Workspace.id, Workspace.name)}
    folders = [report.collection_id, *folders_of_report(db, report.id)]
    sources: dict[int, int] = {}  # pasta com a concessao -> pasta do relatorio que a recebe
    for folder in folders:
        for source in [folder, *ancestors(parents, folder)]:
            sources.setdefault(source, folder)
    result: dict[tuple[str, int], tuple[set[str], list[Origin]]] = {}
    rows = db.query(AccessGrant).filter(AccessGrant.workspace_id.in_(list(sources) or [-1])).all()
    for row in rows:
        subject = ("group", row.group_id) if row.group_id else ("user", row.user_id)
        keys, origins = result.setdefault(subject, (set(), []))
        keys.add(row.permission_key)
        label = names.get(row.workspace_id, str(row.workspace_id))
        in_folders = row.workspace_id in folders
        origin = Origin(kind="folder" if in_folders else "inherited", label=label if in_folders else f"Herdado de {label}")
        if all(o.label != origin.label for o in origins):
            origins.append(origin)
    # So interessa quem de fato abre o relatorio por pasta (ver a pasta)
    return {s: (k, o) for s, (k, o) in result.items() if COLLECTION_VIEW in k}


@router.get("/{kind}/{item_id}", response_model=PanelOut)
def get_panel(kind: Kind, item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = _item(db, kind, item_id)
    access = _require_manage(db, current_user, kind, item)
    capable = _capable(kind)

    direct: dict[tuple[str, int], set[str]] = {}
    for user_id, group_id, key in _grants(db, kind, item_id):
        direct.setdefault(("group", group_id) if group_id else ("user", user_id), set()).add(key)
    folder = _folder_origins(db, item) if kind == "report" else {}
    subjects = set(direct) | set(folder)
    users = {u.id: u for u in db.query(User).filter(User.id.in_([i for k, i in subjects if k == "user"] or [-1]))}
    groups = {g.id: g for g in db.query(Group).filter(Group.id.in_([i for k, i in subjects if k == "group"] or [-1]))}

    entries: list[Entry] = []
    for subject in subjects:
        sub_kind, sub_id = subject
        person = users.get(sub_id) if sub_kind == "user" else None
        group = groups.get(sub_id) if sub_kind == "group" else None
        if person is None and group is None:
            continue
        if group is not None and group.is_admin_group:
            continue
        keys = direct.get(subject, set())
        folder_keys, folder_origins = folder.get(subject, (set(), []))
        origins = ([Origin(kind="direct", label="Direto")] if keys else []) + folder_origins
        effective = set(keys)
        if kind == "report":
            effective |= {k for k in folder_keys if k in REPORT_CAPABLE}
            if COLLECTION_VIEW in folder_keys:
                effective.add(REPORT_VIEW)
        entries.append(
            Entry(
                subject_kind=sub_kind,
                subject_id=sub_id,
                name=person.name if person else group.name,
                email=person.email if person else None,
                picture_url=person.picture_url if person else None,
                permissions=sorted(k for k in keys if k in capable),
                effective=sorted(effective),
                preset=preset_of(kind, keys),
                origins=origins,
            )
        )
    entries.sort(key=lambda e: (e.subject_kind != "group", e.name.lower()))

    ordered = [p for p in access_catalog.CATALOG if p.key in capable]
    return PanelOut(
        item=ItemRef(kind=kind, id=item.id, name=item.name, subtitle=getattr(item, "pbi_workspace_name", None)),
        entries=entries,
        presets=[PresetOut(key=key, label=LABELS[kind][key], permissions=list(keys)) for key, keys in PRESETS[kind].items()],
        permissions=[PermissionItem(key=p.key, label=p.label, description=p.description) for p in ordered],
        can_manage=True if access else False,
    )


def _audit(db: Session, actor: User, kind: Kind, item, details: str) -> None:
    workspace_id = report_access.collection_name_for_audit(db, item) if kind == "report" else None
    log_action(db, action="update", entity={"report": "report_access", "dataset": "dataset_access", "connection": "connection_access"}[kind], user_id=actor.id, workspace_id=workspace_id, entity_id=str(item.id), details=details[:300])


@router.put("/{kind}/{item_id}/{subject_kind}/{subject_id}")
def put_subject(
    kind: Kind,
    item_id: int,
    subject_kind: SubjectKind,
    subject_id: int,
    data: PutIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Define o acesso direto de uma pessoa ou grupo a este item (preset ou lista; vazio remove). Quem so recebeu acesso
    por uma pasta nao perde nada ao remover o direto."""
    item = _item(db, kind, item_id)
    access = _require_manage(db, current_user, kind, item)
    if subject_kind == "group":
        subject = db.query(Group).get(subject_id)
        if subject is None:
            raise HTTPException(status_code=404, detail="Grupo nao encontrado")
        if subject.is_admin_group:
            raise HTTPException(status_code=400, detail="O grupo Administradores ja tem acesso a tudo")
        column, label = "group_id", f"grupo {subject.name}"
    else:
        subject = db.query(User).get(subject_id)
        if subject is None:
            raise HTTPException(status_code=404, detail="Pessoa nao encontrada")
        if is_platform_admin(db, subject_id):
            raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a tudo")
        column, label = "user_id", subject.email

    wanted = _keys_for(kind, data.preset, data.permissions)
    mod = _mod(kind)
    after = set(mod.validate_keys(wanted)) if wanted else set()
    before = mod.subject_keys(db, item.id, column, subject_id)
    if kind == "report":
        mod.check_can_change(access, item, before ^ after, folders_of_report(db, item.id))
    else:
        mod.check_can_change(access, item.id, before ^ after)
    mod.set_subject_keys(db, item.id, column, subject_id, after)
    db.commit()
    _audit(db, current_user, kind, item, f"{item.name}, {label}: +{len(after - before)} -{len(before - after)}")
    return {"permissions": sorted(after), "preset": preset_of(kind, after)}


@router.post("/{kind}/{item_id}/invite")
def invite_by_email(kind: Kind, item_id: int, data: InviteIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Compartilha por e-mail. Quem ja tem conta recebe na hora. Para um e-mail sem conta, o acesso fica reservado num convite
    (que entra no grupo "Todos os usuarios"); criar o convite e adicionar um membro, entao pede a permissao de adicionar
    membros. Nenhum e-mail e enviado daqui: avise a pessoa para se cadastrar com este endereco."""
    if kind == "connection":
        raise HTTPException(status_code=400, detail="Contas do Power BI nao tem convite por e-mail: a pessoa precisa ja ter conta no portal")
    item = _item(db, kind, item_id)
    access = _require_manage(db, current_user, kind, item)
    mod = _mod(kind)
    keys = set(mod.validate_keys(_keys_for(kind, data.preset, data.permissions)))
    if not keys:
        raise HTTPException(status_code=422, detail="Escolha o que a pessoa pode fazer")
    if kind == "report":
        mod.check_can_change(access, item, keys, folders_of_report(db, item.id))
    else:
        mod.check_can_change(access, item.id, keys)

    user = db.query(User).filter(User.email == data.email).first()
    if user is not None:
        if is_platform_admin(db, user.id):
            raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a tudo")
        column = "user_id"
        mod.set_subject_keys(db, item.id, column, user.id, mod.subject_keys(db, item.id, column, user.id) | keys)
        db.commit()
        _audit(db, current_user, kind, item, f"{item.name}, {user.email}")
        return {"status": "applied", "subject_kind": "user", "subject_id": user.id}

    if db.query(GroupInvite.id).filter(GroupInvite.email == data.email).first() is None:
        if not (access.is_admin or access.has_global("membros.adicionar")):
            raise HTTPException(status_code=403, detail="Esta pessoa ainda nao tem conta nem convite. Peca a quem adiciona membros para convida-la.")
        default_group = get_or_create_default_group(db)
        db.add(GroupInvite(email=data.email, group_id=default_group.id, invited_by_id=current_user.id))
        db.flush()
    if kind == "report":
        db.query(ReportInviteGrant).filter(ReportInviteGrant.email == data.email, ReportInviteGrant.report_id == item.id).delete(synchronize_session=False)
        for key in sorted(keys):
            db.add(ReportInviteGrant(email=data.email, report_id=item.id, permission_key=key))
    else:
        db.query(DatasetInviteGrant).filter(DatasetInviteGrant.email == data.email, DatasetInviteGrant.dataset_id == item.id).delete(synchronize_session=False)
        for key in sorted(keys):
            db.add(DatasetInviteGrant(email=data.email, dataset_id=item.id, permission_key=key))
    db.commit()
    _audit(db, current_user, kind, item, f"{item.name}, {data.email} (convite)")
    return {"status": "pending", "subject_kind": None, "subject_id": None}


class SubjectItem(BaseModel):
    kind: Kind
    id: int
    name: str
    subtitle: Optional[str] = None
    in_root: bool = False
    permissions: list[str]
    preset: Optional[str] = None


class SubjectItemsPage(BaseModel):
    items: list[SubjectItem]
    total: int
    page: int
    page_size: int


@router.get("/by-subject/{subject_kind}/{subject_id}", response_model=SubjectItemsPage)
def items_of_subject(
    subject_kind: SubjectKind,
    subject_id: int,
    kind: Kind = "report",
    search: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A lista de relatorios (ou modelos) que uma pessoa ou um grupo recebeu DIRETO, com o preset de cada um: a mesma lista
    que Gerenciar usuarios mostra e edita. So para quem ve membros, grupos ou edita permissoes."""
    access = effective_access(db, current_user.id)
    if not (access.is_admin or any(access.has_global(key) for key in ("membros.ver", "grupos.ver", "permissoes.editar"))):
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para essa acao")
    column = "group_id" if subject_kind == "group" else "user_id"
    if kind == "report":
        rows = db.query(ReportGrant.report_id, ReportGrant.permission_key).filter(getattr(ReportGrant, column) == subject_id).all()
    elif kind == "connection":
        rows = db.query(ConnectionGrant.connection_id, ConnectionGrant.permission_key).filter(getattr(ConnectionGrant, column) == subject_id).all()
    else:
        rows = db.query(DatasetGrant.dataset_id, DatasetGrant.permission_key).filter(getattr(DatasetGrant, column) == subject_id).all()
    keys_by_item: dict[int, set[str]] = {}
    for item_id, key in rows:
        keys_by_item.setdefault(item_id, set()).add(key)
    if kind == "report":
        found = db.query(Report, Workspace).join(Workspace, Workspace.id == Report.collection_id).filter(Report.id.in_(list(keys_by_item) or [-1])).all()
        entries = [(r.id, r.name, r.pbi_workspace_name, w.system_key is not None) for r, w in found]
    elif kind == "connection":
        found = db.query(PowerBIConnection).filter(PowerBIConnection.id.in_(list(keys_by_item) or [-1])).all()
        entries = [(c.id, c.name, None, False) for c in found]
    else:
        found = db.query(PbiDataset).filter(PbiDataset.id.in_(list(keys_by_item) or [-1])).all()
        entries = [(d.id, d.name, d.pbi_workspace_name, False) for d in found]
    needle = search.strip().lower()
    entries = [e for e in entries if not needle or needle in e[1].lower()]
    entries.sort(key=lambda e: (e[1].lower(), e[0]))
    total = len(entries)
    window = entries[(page - 1) * page_size : page * page_size]
    return SubjectItemsPage(
        items=[
            SubjectItem(kind=kind, id=i, name=n, subtitle=w, in_root=root, permissions=sorted(keys_by_item[i]), preset=preset_of(kind, keys_by_item[i]))
            for i, n, w, root in window
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


class BulkItem(BaseModel):
    kind: Kind
    id: int


class BulkShareIn(BaseModel):
    items: list[BulkItem] = Field(min_length=1, max_length=200)
    user_ids: list[int] = Field(default_factory=list, max_length=100)
    group_ids: list[int] = Field(default_factory=list, max_length=100)
    preset: Optional[str] = None
    permissions: Optional[list[str]] = Field(default=None, max_length=60)
    mode: Literal["add", "remove"] = "add"


class BulkOut(BaseModel):
    items: int
    subjects: int
    changes: int


@router.post("/bulk", response_model=BulkOut)
def bulk_share(data: BulkShareIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Da (ou tira) o mesmo acesso de varios itens (relatorios e modelos) a varias pessoas e grupos. Confere tudo antes de
    gravar: o pedido inteiro entra ou nenhuma parte dele."""
    if not data.user_ids and not data.group_ids:
        raise HTTPException(status_code=422, detail="Escolha ao menos uma pessoa ou um grupo")
    groups = db.query(Group).filter(Group.id.in_(data.group_ids or [-1])).all()
    users = db.query(User).filter(User.id.in_(data.user_ids or [-1])).all()
    if len(groups) != len(set(data.group_ids)) or len(users) != len(set(data.user_ids)):
        raise HTTPException(status_code=404, detail="Pessoa ou grupo nao encontrado")
    if any(g.is_admin_group for g in groups) or any(is_platform_admin(db, u.id) for u in users):
        raise HTTPException(status_code=400, detail="Quem esta no grupo Administradores ja tem acesso a tudo")

    plan = []
    for entry in dict.fromkeys((i.kind, i.id) for i in data.items):
        kind, item_id = entry
        item = _item(db, kind, item_id)
        access = _require_manage(db, current_user, kind, item)
        mod = _mod(kind)
        wanted = _keys_for(kind, data.preset, data.permissions)
        if not wanted:
            raise HTTPException(status_code=422, detail="Escolha o que dar ou tirar")
        keys = set(mod.validate_keys(wanted)) if data.mode == "add" else mod.with_dependents(set(wanted) & _capable(kind))
        if kind == "report":
            mod.check_can_change(access, item, keys, folders_of_report(db, item.id))
        else:
            mod.check_can_change(access, item.id, keys)
        for column, subject_id in [("group_id", g.id) for g in groups] + [("user_id", u.id) for u in users]:
            before = mod.subject_keys(db, item.id, column, subject_id)
            after = (before | keys) if data.mode == "add" else (before - keys)
            plan.append((kind, item, mod, column, subject_id, before, after))

    changes = 0
    for kind, item, mod, column, subject_id, before, after in plan:
        if before != after:
            mod.set_subject_keys(db, item.id, column, subject_id, after)
            changes += 1
    db.commit()
    log_action(db, action="update", entity="report_access", user_id=current_user.id, details=f"{'dar' if data.mode == 'add' else 'tirar'}: {len(set((k, i.id) for k, i, *_ in plan))} itens, {len(groups)} grupos, {len(users)} pessoas")
    return BulkOut(items=len({(p[0], p[1].id) for p in plan}), subjects=len(groups) + len(users), changes=changes)


class BulkFoldersIn(BaseModel):
    report_ids: list[int] = Field(min_length=1, max_length=200)
    add: list[int] = Field(default_factory=list, max_length=50)
    remove: list[int] = Field(default_factory=list, max_length=50)


@router.post("/bulk-folders", response_model=BulkOut)
def bulk_folders(data: BulkFoldersIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Poe (ou tira) varios relatorios de varias pastas de uma vez, sem mexer nas outras pastas deles. Cada relatorio e cada
    pasta seguem as regras de sempre (editar o relatorio e publicar na pasta); confere tudo antes de gravar."""
    from app.core.access_engine import can_in_workspace
    from app.core.root_collection import ensure_root_collection
    from app.models.report_grant import ReportCollection
    from app.routers.reports import ReportFoldersIn, set_report_folders

    if not data.add and not data.remove:
        raise HTTPException(status_code=422, detail="Escolha ao menos uma pasta")
    folder_ids = set(data.add) | set(data.remove)
    found = {w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(folder_ids))}
    if len(found) != len(folder_ids) or any(w.system_key is not None for w in found.values()):
        raise HTTPException(status_code=400, detail="Escolha pastas que existem; a Raiz nao e uma pasta")
    reports = db.query(Report).filter(Report.id.in_(set(data.report_ids))).all()
    if len(reports) != len(set(data.report_ids)):
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")

    root = ensure_root_collection(db)
    plan = []
    for report in reports:
        access = effective_access(db, current_user.id)
        if not access.has_in_report("relatorio.editar", report.id, report.collection_id, folders_of_report(db, report.id)):
            raise HTTPException(status_code=403, detail=f"Voce nao pode editar o relatorio {report.name}")
        links = [row[0] for row in db.query(ReportCollection.collection_id).filter(ReportCollection.report_id == report.id).order_by(ReportCollection.id)]
        current = ([] if report.collection_id == root.id else [report.collection_id]) + links
        wanted = [f for f in current if f not in data.remove] + [f for f in data.add if f not in current and f not in data.remove]
        for folder_id in set(wanted) ^ set(current):
            if not can_in_workspace(db, current_user.id, "relatorio.publicar", folder_id):
                raise HTTPException(status_code=403, detail="Voce nao pode publicar nem tirar relatorios de uma das pastas")
        plan.append((report, wanted, current))

    changed = 0
    for report, wanted, current in plan:
        if set(wanted) != set(current):
            set_report_folders(report.collection_id, report.id, ReportFoldersIn(collection_ids=wanted), db, current_user)
            changed += 1
    return BulkOut(items=len(plan), subjects=len(folder_ids), changes=changed)
