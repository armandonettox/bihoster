"""Permissao por modelo semantico: gravar, conferir e reservar o que um grupo ou uma pessoa pode num modelo so.

Espelha core/report_access.py (as concessoes ficam em dataset_grants, e so se da e se tira o que se tem). `modelo.ver`
nao da acesso aos relatorios do modelo."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_catalog import DATASET_CAPABLE, DATASET_SHARE, DATASET_VIEW, with_implied_dataset
from app.core.access_engine import EffectiveAccess, effective_access
from app.models.catalog_sync import PbiDataset
from app.models.dataset_grant import DatasetGrant, DatasetInviteGrant
from app.models.user import User

GROUP = "group_id"
USER = "user_id"


def validate_keys(keys: list[str]) -> list[str]:
    """So aceita itens que valem num modelo, sem repetidos e com o que cada um exige (atualizar exige ver)."""
    unknown = [key for key in keys if key not in DATASET_CAPABLE]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Permissao que nao vale num modelo: {', '.join(sorted(set(unknown)))}")
    return with_implied_dataset(keys)


def with_dependents(keys: set[str]) -> set[str]:
    """Tirar "ver o modelo" tira tambem tudo o que depende dele."""
    return set(DATASET_CAPABLE) if DATASET_VIEW in keys else set(keys)


def can_manage(access: EffectiveAccess, dataset_id: int) -> bool:
    return access.is_admin or access.has_global("permissoes.editar") or access.has_in_dataset(DATASET_SHARE, dataset_id)


def require_can_manage(db: Session, actor: User, dataset: PbiDataset) -> EffectiveAccess:
    access = effective_access(db, actor.id)
    if not can_manage(access, dataset.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Voce nao pode mudar os acessos deste modelo")
    return access


def check_can_change(access: EffectiveAccess, dataset_id: int, changed: set[str]) -> None:
    """Tudo o que entra ou sai precisa ser algo que quem faz a mudanca tem neste modelo."""
    if access.is_admin:
        return
    missing = sorted(key for key in changed if not access.has_in_dataset(key, dataset_id))
    if missing:
        labels = ", ".join(dict.fromkeys(access_catalog.get(key).label if access_catalog.get(key) else key for key in missing))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Voce so pode dar ou tirar permissoes que voce mesmo tem neste modelo. Faltam: {labels}",
        )


def subject_keys(db: Session, dataset_id: int, subject: str, subject_id: int) -> set[str]:
    rows = db.query(DatasetGrant.permission_key).filter(DatasetGrant.dataset_id == dataset_id, getattr(DatasetGrant, subject) == subject_id).all()
    return {row[0] for row in rows}


def set_subject_keys(db: Session, dataset_id: int, subject: str, subject_id: int, keys: set[str]) -> tuple[set[str], set[str]]:
    """Deixa o grupo ou a pessoa com exatamente `keys` neste modelo. Devolve (antes, depois). Quem chama faz o commit."""
    rows = db.query(DatasetGrant).filter(DatasetGrant.dataset_id == dataset_id, getattr(DatasetGrant, subject) == subject_id).all()
    before = {row.permission_key for row in rows}
    for row in rows:
        if row.permission_key not in keys:
            db.delete(row)
    for key in keys - before:
        db.add(DatasetGrant(dataset_id=dataset_id, permission_key=key, **{subject: subject_id}))
    return before, set(keys)


def apply_pending_dataset_grants(db: Session, user: User, had_invites: bool) -> bool:
    """Chamada quando a conta e criada: aplica o que foi reservado para o e-mail em modelos (so se havia convite) e apaga o
    resto. Devolve se mexeu no banco; quem chama faz o commit."""
    rows = db.query(DatasetInviteGrant).filter(DatasetInviteGrant.email == user.email).all()
    if not rows:
        return False
    if had_invites:
        existing = {row.id for row in db.query(PbiDataset.id).filter(PbiDataset.id.in_({r.dataset_id for r in rows}))}
        taken = {(g.dataset_id, g.permission_key) for g in db.query(DatasetGrant).filter(DatasetGrant.user_id == user.id)}
        for row in rows:
            if row.dataset_id in existing and (row.dataset_id, row.permission_key) not in taken and row.permission_key in DATASET_CAPABLE:
                db.add(DatasetGrant(dataset_id=row.dataset_id, user_id=user.id, permission_key=row.permission_key))
    for row in rows:
        db.delete(row)
    return True
