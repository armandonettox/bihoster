"""Seguranca por funcao (RLS e OLS) de cada modelo semantico: que funcao do Power BI cada grupo e cada pessoa recebe.

So de quem tem `modelo.seguranca`. Ver core/dataset_security.py para as regras (so vale com mapeamento, falha fechada e
as funcoes na chave do cache)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.core import dataset_security, powerbi
from app.core.access_deps import require_global_permission
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.user import User
from app.models.workspace import Group
from app.routers import powerbi as embed_router

router = APIRouter(prefix="/catalog/datasets/{dataset_id}/security", tags=["dataset-security"])

MAX_GRANTS = 500
# Nome de usuario so do teste da funcao: nao e de ninguem e o token gerado nunca sai do servidor
TEST_USERNAME = "bihoster-teste"


class GrantIn(BaseModel):
    group_id: Optional[int] = None
    user_id: Optional[int] = None
    pbi_role: str

    @field_validator("pbi_role")
    @classmethod
    def role_valid(cls, value: str) -> str:
        return dataset_security.clean_role(value)

    @model_validator(mode="after")
    def exactly_one_subject(self):
        if (self.group_id is None) == (self.user_id is None):
            raise ValueError("Informe um grupo ou uma pessoa, so um dos dois")
        return self


class SecurityIn(BaseModel):
    # Marca o modelo cujo RLS depende so das funcoes (nenhuma regra usa USERNAME()): deixa pessoas com o mesmo conjunto
    # de funcoes dividirem o token. Em duvida, deixe desligado.
    rls_shared_by_roles: Optional[bool] = None
    grants: list[GrantIn] = Field(default_factory=list, max_length=MAX_GRANTS)


class GrantOut(BaseModel):
    group_id: Optional[int] = None
    user_id: Optional[int] = None
    subject_name: str
    subject_email: Optional[str] = None
    pbi_role: str


class SecurityOut(BaseModel):
    dataset_id: int
    name: str
    pbi_workspace_name: Optional[str] = None
    requires_identity: Optional[bool] = None
    rls_shared_by_roles: Optional[bool] = None
    reports_count: int
    # Com ao menos uma linha, o modelo passa a exigir funcao: quem nao tiver nenhuma nao abre o relatorio
    active: bool
    grants: list[GrantOut]


class RoleTestIn(BaseModel):
    pbi_role: str

    @field_validator("pbi_role")
    @classmethod
    def role_valid(cls, value: str) -> str:
        return dataset_security.clean_role(value)


class RoleTestOut(BaseModel):
    ok: bool
    message: str


def _dataset_or_404(db: Session, dataset_id: int) -> PbiDataset:
    dataset = db.query(PbiDataset).get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Modelo semantico nao encontrado")
    return dataset


def _reports_of(db: Session, dataset: PbiDataset) -> list[Report]:
    return (
        db.query(Report)
        .filter(
            Report.powerbi_connection_id == dataset.connection_id,
            Report.pbi_workspace_id == dataset.pbi_workspace_id,
            Report.pbi_dataset_id == dataset.pbi_dataset_id,
        )
        .all()
    )


def _out(db: Session, dataset: PbiDataset) -> SecurityOut:
    rows = db.query(DatasetRoleGrant).filter(DatasetRoleGrant.dataset_id == dataset.id).order_by(DatasetRoleGrant.pbi_role, DatasetRoleGrant.id).all()
    groups = {g.id: g for g in db.query(Group).filter(Group.id.in_([r.group_id for r in rows if r.group_id] or [-1])).all()}
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r.user_id for r in rows if r.user_id] or [-1])).all()}
    grants = []
    for row in rows:
        if row.group_id is not None and row.group_id in groups:
            grants.append(GrantOut(group_id=row.group_id, subject_name=groups[row.group_id].name, pbi_role=row.pbi_role))
        elif row.user_id is not None and row.user_id in users:
            user = users[row.user_id]
            grants.append(GrantOut(user_id=row.user_id, subject_name=user.name, subject_email=user.email, pbi_role=row.pbi_role))
    return SecurityOut(
        dataset_id=dataset.id,
        name=dataset.name,
        pbi_workspace_name=dataset.pbi_workspace_name,
        requires_identity=dataset.is_effective_identity_required,
        rls_shared_by_roles=dataset.rls_shared_by_roles,
        reports_count=len(_reports_of(db, dataset)),
        active=bool(rows),
        grants=grants,
    )


@router.get("", response_model=SecurityOut)
def get_security(dataset_id: int, db: Session = Depends(get_db), _: User = Depends(require_global_permission("modelo.seguranca"))):
    return _out(db, _dataset_or_404(db, dataset_id))


@router.put("", response_model=SecurityOut)
def put_security(
    dataset_id: int,
    data: SecurityIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission("modelo.seguranca")),
):
    """Troca o mapeamento do modelo inteiro. Com ao menos uma linha o modelo passa a exigir funcao para abrir; sem nenhuma
    volta ao comportamento de antes. O token em cache dos relatorios do modelo e descartado."""
    dataset = _dataset_or_404(db, dataset_id)
    unique = list(dict.fromkeys((g.group_id, g.user_id, g.pbi_role) for g in data.grants))
    group_ids = {g for g, _, _ in unique if g is not None}
    user_ids = {u for _, u, _ in unique if u is not None}
    if group_ids and db.query(Group).filter(Group.id.in_(group_ids)).count() != len(group_ids):
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    if user_ids and db.query(User).filter(User.id.in_(user_ids)).count() != len(user_ids):
        raise HTTPException(status_code=404, detail="Pessoa nao encontrada")

    before = db.query(DatasetRoleGrant).filter(DatasetRoleGrant.dataset_id == dataset.id).count()
    db.query(DatasetRoleGrant).filter(DatasetRoleGrant.dataset_id == dataset.id).delete(synchronize_session=False)
    for group_id, user_id, role in unique:
        db.add(DatasetRoleGrant(dataset_id=dataset.id, group_id=group_id, user_id=user_id, pbi_role=role))
    dataset.rls_shared_by_roles = data.rls_shared_by_roles
    db.commit()

    # Ninguem reaproveita um token feito com as funcoes antigas (as funcoes tambem estao na chave, e isto tira o resto)
    embed_router.invalidate_embed_cache_for_reports({report.id for report in _reports_of(db, dataset)})
    log_action(
        db,
        action="update",
        entity="dataset_security",
        user_id=current_user.id,
        entity_id=str(dataset.id),
        details=f"{dataset.name}: {before} para {len(unique)} funcoes mapeadas",
    )
    return _out(db, dataset)


@router.post("/test", response_model=RoleTestOut)
@limiter.limit("10/minute")
def test_role(
    request: Request,
    dataset_id: int,
    data: RoleTestIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_global_permission("modelo.seguranca")),
):
    """Tenta gerar um token com a funcao num relatorio do modelo: confirma que o nome existe e que o Power BI a aceita. O
    token nunca e devolvido nem guardado. Nao confirma o que a funcao deixa ver: isso se confere abrindo o relatorio."""
    dataset = _dataset_or_404(db, dataset_id)
    report = next((r for r in _reports_of(db, dataset)), None)
    if report is None:
        return RoleTestOut(ok=False, message="Nenhum relatorio do portal usa este modelo ainda: cadastre um para poder testar.")
    connection = db.query(PowerBIConnection).get(dataset.connection_id)
    if connection is None:
        return RoleTestOut(ok=False, message="A conta do Power BI deste modelo nao existe mais.")
    try:
        powerbi.generate_embed_token(
            connection,
            workspace_id=report.pbi_workspace_id,
            report_id=report.pbi_report_id,
            dataset_id=dataset.pbi_dataset_id,
            username=TEST_USERNAME,
            roles=[data.pbi_role],
        )
    except powerbi.PowerBIError as exc:
        return RoleTestOut(ok=False, message=str(exc)[:300])
    return RoleTestOut(ok=True, message="O Power BI aceitou a funcao.")
