"""Defesas contra escalada de privilégio nas rotas de Administração.

Delegar "dar permissões", "gerenciar grupos" ou "gerenciar membros" só é seguro se quem recebe esse poder não puder usá-lo
para chegar mais longe do que já está. Três regras, aplicadas por estas funções:

1. Só se dá e se tira o que se tem: em qualquer mudança de permissões (de grupo, de pessoa, convite), cada permissão que
   muda precisa ser uma que quem faz a mudança também tem, no mesmo escopo. O administrador da plataforma tem todas.
2. Entrar num grupo é receber as permissões dele: só se coloca alguém num grupo cujas permissões a própria pessoa tem, e o
   grupo Administradores só o administrador da plataforma mexe (nenhuma permissão dá o papel de administrador, L-314).
3. A conta de um administrador da plataforma só é mexida por outro administrador (gerar link de senha, apagar a conta)."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_engine import EffectiveAccess, effective_access
from app.core.workspace_deps import is_platform_admin
from app.models.access_grant import AccessGrant
from app.models.user import User
from app.models.workspace import Group

# Chaves por escopo: None é o sistema todo, um número é o id da coleção
ScopeKeys = dict[int | None, set[str]]


def keys_by_scope_of_blocks(blocks) -> ScopeKeys:
    """De uma lista de blocos (workspace_id e permissions) para chaves por escopo. Bloco vazio não conta."""
    result: ScopeKeys = {}
    for block in blocks:
        if block.permissions:
            result.setdefault(block.workspace_id, set()).update(block.permissions)
    return result


def keys_by_scope_of_rows(rows) -> ScopeKeys:
    result: ScopeKeys = {}
    for row in rows:
        result.setdefault(row.workspace_id, set()).add(row.permission_key)
    return result


def current_keys_by_scope(db: Session, subject: dict) -> ScopeKeys:
    """As permissões que um grupo ou uma pessoa têm agora; `subject` é {"group_id": id} ou {"user_id": id}."""
    return keys_by_scope_of_rows(db.query(AccessGrant).filter_by(**subject).all())


def _holds(access: EffectiveAccess, key: str, scope: int | None) -> bool:
    return access.has_global(key) if scope is None else access.has_in_workspace(key, scope)


def _label(key: str) -> str:
    permission = access_catalog.get(key)
    return permission.label if permission else key


def _deny(message: str, keys: list[str]) -> HTTPException:
    labels = ", ".join(dict.fromkeys(_label(key) for key in keys))
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{message}: {labels}")


def check_can_change_grants(db: Session, actor: User, before: ScopeKeys, after: ScopeKeys) -> None:
    """Regra 1: tudo o que muda entre `before` e `after` (o que entra e o que sai) precisa ser algo que `actor` tem."""
    access = effective_access(db, actor.id)
    if access.is_admin:
        return
    missing: list[str] = []
    for scope in set(before) | set(after):
        changed = before.get(scope, set()) ^ after.get(scope, set())
        missing.extend(key for key in sorted(changed) if not _holds(access, key, scope))
    if missing:
        raise _deny("Voce so pode dar ou tirar permissoes que voce mesmo tem. Faltam", missing)


def check_can_give_keys(db: Session, actor: User, wanted: ScopeKeys) -> None:
    """Variante só de entrada (convite com permissões reservadas): tudo o que se pede precisa ser algo que `actor` tem."""
    check_can_change_grants(db, actor, {}, wanted)


def check_can_put_in_group(db: Session, actor: User, group: Group) -> None:
    """Regra 2: colocar alguém no grupo dá a ela as permissões do grupo."""
    access = effective_access(db, actor.id)
    if access.is_admin:
        return
    if group.is_admin_group:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="So um administrador da plataforma coloca alguem no grupo Administradores",
        )
    rows = db.query(AccessGrant).filter(AccessGrant.group_id == group.id).all()
    missing = [row.permission_key for row in rows if not _holds(access, row.permission_key, row.workspace_id)]
    if missing:
        raise _deny(f"O grupo {group.name} da permissoes que voce nao tem. Faltam", missing)


def check_can_touch_account(db: Session, actor: User, target_user_id: int) -> None:
    """Regra 3: a conta de um administrador da plataforma só é mexida por outro administrador."""
    if is_platform_admin(db, target_user_id) and not is_platform_admin(db, actor.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="So um administrador da plataforma mexe na conta de outro administrador",
        )


def check_can_leave_admin_group_alone(db: Session, actor: User, group: Group) -> None:
    """Tirar alguém do grupo Administradores também é coisa de administrador da plataforma."""
    if group.is_admin_group and not is_platform_admin(db, actor.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="So um administrador da plataforma tira alguem do grupo Administradores",
        )
