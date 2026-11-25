from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.access_deps import require_global_permission, require_workspace_permission
from app.core.access_engine import can_global, can_in_workspace
from app.core.folder_tree import load_parent_map, validate_parent, visible_with_path
from app.core.root_collection import ensure_root_collection, stop_sends_of_unpublished_reports
from app.core.access_roles import give_user_role
from app.core.audit import log_action
from app.core.audit_revert import WORKSPACE_UPDATE, changed_fields
from app.core.database import get_db
from app.core.root_collection import is_system_workspace
from app.core.slug import slugify
from app.core.workspace_deps import (
    ensure_default_group_access,
    get_effective_role,
    get_effective_roles_map,
    is_platform_admin,
    require_workspace_member,
)
from app.models.access_grant import AccessGrant, AccessInviteGrant
from app.models.audit_log import AuditLog
from app.models.favorite import Favorite
from app.models.report import Report
from app.models.report_grant import ReportCollection, ReportGrant, ReportInviteGrant
from app.models.settings import AppSettings
from app.core.ai_report_settings import delete_settings_of_reports
from app.models.subscription import delete_subscriptions_of_reports
from app.models.user import User, UserRole
from app.models.workspace import Workspace
from app.routers.auth import get_current_user
from app.schemas.workspace import WorkspaceCreate, WorkspaceOut, WorkspaceUpdate

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug = base
    counter = 2
    while db.query(Workspace).filter(Workspace.slug == slug).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def _to_out(workspace: Workspace, role: UserRole) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        description=workspace.description,
        icon=workspace.icon,
        color=workspace.color,
        tv_interval_seconds=workspace.tv_interval_seconds,
        parent_id=workspace.parent_id,
        role=role,
    )


@router.get("/", response_model=list[WorkspaceOut])
def list_my_workspaces(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """So as colecoes que o usuario realmente enxerga -- acesso vem exclusivamente dos grupos dele."""
    roles_by_workspace = get_effective_roles_map(db, current_user.id)
    result = []
    for workspace in db.query(Workspace).order_by(Workspace.name).all():
        role = roles_by_workspace.get(workspace.id)
        if role is not None:
            result.append(_to_out(workspace, role))
    return result


@router.get("/all", response_model=list[WorkspaceOut])
def list_all_workspaces(db: Session = Depends(get_db), current_user: User = Depends(require_global_permission("colecao.todas"))):
    """Todas as colecoes do sistema -- usado no painel de gestao (quem tem 'ver todas as coleções').
    O papel devolvido e sempre admin: a tela de gestao so usa a lista, o papel de verdade vem de /workspaces/."""
    workspaces = db.query(Workspace).filter(Workspace.system_key.is_(None)).order_by(Workspace.name).all()
    return [_to_out(w, UserRole.admin) for w in workspaces]


class TreeNode(BaseModel):
    id: int
    name: str
    slug: str
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_id: Optional[int] = None
    # False = so aparece como caminho ate uma subpasta que a pessoa acessa: sem o conteudo e sem poder abrir
    accessible: bool


@router.get("/tree", response_model=list[TreeNode])
def workspace_tree(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """A arvore de pastas que a pessoa enxerga: as que ela acessa e as de cima delas, estas so como caminho de navegacao
    (so o nome, sem o que ha dentro). Pasta que ela nao acessa nem leva a uma que acessa nao aparece."""
    accessible = set(get_effective_roles_map(db, current_user.id))
    parents = load_parent_map(db)
    shown = visible_with_path(accessible, parents)
    rows = db.query(Workspace).filter(Workspace.id.in_(list(shown) or [-1]), Workspace.system_key.is_(None)).order_by(Workspace.name).all()
    return [
        TreeNode(
            id=w.id,
            name=w.name,
            slug=w.slug,
            icon=w.icon if shown[w.id] else None,
            color=w.color if shown[w.id] else None,
            parent_id=w.parent_id,
            accessible=shown[w.id],
        )
        for w in rows
    ]


def _check_parent(db: Session, actor: User, workspace_id: int | None, parent_id: int | None) -> None:
    """Mexer na pasta onde uma colecao fica: o destino precisa existir, nao pode fechar um ciclo nem passar da
    profundidade maxima, e quem faz precisa poder criar subpastas la (ou, para pasta de topo, poder criar colecoes)."""
    reason = validate_parent(load_parent_map(db), workspace_id, parent_id)
    if reason is not None:
        raise HTTPException(status_code=400, detail=reason)
    parent = db.query(Workspace).get(parent_id) if parent_id is not None else None
    if parent is not None and parent.system_key is not None:
        raise HTTPException(status_code=400, detail="Nao da para criar pastas dentro da Raiz")
    if parent_id is None:
        allowed = can_global(db, actor.id, "colecao.criar")
    else:
        allowed = can_in_workspace(db, actor.id, "colecao.criar-subpasta", parent_id)
    if not allowed:
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para criar pastas aqui" if parent_id is not None else "Voce nao tem permissao para essa acao")


@router.post("/", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: WorkspaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Sem pasta pai vale o item geral de criar colecoes; dentro de uma pasta, o de criar subpastas nela
    _check_parent(db, current_user, None, data.parent_id)
    # Retry em cima de IntegrityError (nao so a checagem previa) -- duas criacoes concorrentes
    # com o mesmo nome podem passar pelo _unique_slug antes de qualquer commit e colidir no
    # commit; sem o retry, a segunda simplesmente falharia com um 500 em vez de tentar de novo.
    for attempt in range(5):
        workspace = Workspace(
            name=data.name,
            slug=_unique_slug(db, data.name),
            description=data.description,
            icon=data.icon,
            color=data.color,
            parent_id=data.parent_id,
        )
        db.add(workspace)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(status_code=409, detail="Nao foi possivel gerar um identificador unico para essa colecao -- tente novamente")
    db.refresh(workspace)

    if data.everyone_can_view:
        ensure_default_group_access(db, workspace.id, UserRole.viewer)
    if not is_platform_admin(db, current_user.id):
        # Quem cria uma colecao sem ser administrador da plataforma passa a ser administrador dela; sem isso nao poderia nem edita-la
        give_user_role(db, current_user.id, workspace.id, UserRole.admin)
        db.commit()

    log_action(db, action="create", entity="workspace", user_id=current_user.id, workspace_id=workspace.id, details=workspace.name)
    return _to_out(workspace, UserRole.admin)


@router.get("/{workspace_id}", response_model=WorkspaceOut)
def get_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_member),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")
    role = get_effective_role(db, current_user.id, workspace_id)
    return _to_out(workspace, role)


@router.put("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: int,
    data: WorkspaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workspace_permission("colecao.editar")),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")

    if is_system_workspace(workspace):
        raise HTTPException(status_code=400, detail="A Raiz e uma colecao interna e nao pode ser alterada")

    updates = data.model_dump(exclude_unset=True)
    if "parent_id" in updates and updates["parent_id"] != workspace.parent_id:
        _check_parent(db, current_user, workspace_id, updates["parent_id"])
    before = {field: getattr(workspace, field) for field in updates}
    for field, value in updates.items():
        setattr(workspace, field, value)
    db.commit()
    db.refresh(workspace)
    fields = changed_fields(before, {field: getattr(workspace, field) for field in updates})

    log_action(
        db,
        action="update",
        entity="workspace",
        user_id=current_user.id,
        workspace_id=workspace_id,
        details=workspace.name,
        change={"kind": WORKSPACE_UPDATE, "fields": fields} if fields else None,
    )
    return _to_out(workspace, UserRole.admin)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_workspace_permission("colecao.excluir")),
):
    workspace = db.query(Workspace).get(workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Colecao nao encontrada")
    if is_system_workspace(workspace):
        raise HTTPException(status_code=400, detail="A Raiz e uma colecao interna e nao pode ser excluida")

    parents = load_parent_map(db)
    if any(parent == workspace_id for parent in parents.values()):
        raise HTTPException(status_code=409, detail="Mova ou exclua primeiro as pastas que estao dentro desta")

    # Excluir uma pasta nunca apaga relatorio: o que era dela passa para a outra pasta em que ja aparecia ou, sem outra,
    # volta para a Raiz (o catalogo), com as permissoes dadas direto nele
    root = ensure_root_collection(db)
    unpublished: list[int] = []
    for report in db.query(Report).filter(Report.collection_id == workspace_id).all():
        other = (
            db.query(ReportCollection)
            .filter(ReportCollection.report_id == report.id, ReportCollection.collection_id != workspace_id)
            .order_by(ReportCollection.position.is_(None), ReportCollection.position, ReportCollection.id)
            .first()
        )
        if other is not None:
            report.collection_id = other.collection_id
            db.delete(other)
        else:
            report.collection_id = root.id
            report.position = None
            unpublished.append(report.id)
    stop_sends_of_unpublished_reports(db, unpublished)
    db.flush()
    db.query(ReportCollection).filter(ReportCollection.collection_id == workspace_id).delete(synchronize_session=False)

    db.query(AuditLog).filter(AuditLog.workspace_id == workspace_id).update(
        {"workspace_id": None}, synchronize_session=False
    )

    db.query(AccessGrant).filter(AccessGrant.workspace_id == workspace_id).delete(synchronize_session=False)
    db.query(AccessInviteGrant).filter(AccessInviteGrant.workspace_id == workspace_id).delete(synchronize_session=False)
    db.delete(workspace)

    settings_row = db.query(AppSettings).filter(AppSettings.id == 1, AppSettings.default_workspace_id == workspace_id).first()
    if settings_row:
        settings_row.default_workspace_id = None

    db.commit()

