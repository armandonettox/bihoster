"""Chaves de permissao, seed dos niveis do sistema e helper has_permission."""
from sqlalchemy.orm import Session

ALL_PERMISSIONS: list[str] = [
    "colecao.criar",
    "colecao.editar",
    "colecao.excluir",
    "colecao.membros",
    "relatorio.publicar",
    "relatorio.editar",
    "relatorio.excluir",
    "visual.menu",
    "visual.exportar_csv",
    "assinatura.criar",
    "assinatura.gerenciar",
    "assinatura.executar",
    "admin.marca",
    "admin.usuarios",
    "admin.conexoes_pbi",
    "admin.email",
    "admin.autenticacao",
    "admin.auditoria",
    "admin.grupos",
    "admin.atualizacoes",
    "admin.niveis",
]

_SYSTEM_LEVELS: list[dict] = [
    {
        "name": "Administrador",
        "description": "Acesso total a todas as funcionalidades da plataforma.",
        "grants": ALL_PERMISSIONS,
    },
    {
        "name": "Editor",
        "description": "Pode criar e editar colecoes e relatorios, gerenciar membros e criar assinaturas.",
        "grants": [
            "colecao.criar",
            "colecao.editar",
            "colecao.membros",
            "relatorio.publicar",
            "relatorio.editar",
            "relatorio.excluir",
            "visual.menu",
            "visual.exportar_csv",
            "assinatura.criar",
            "assinatura.gerenciar",
            "assinatura.executar",
        ],
    },
    {
        "name": "Leitor",
        "description": "Apenas visualizacao de relatorios. Sem permissao para criar ou editar.",
        "grants": [],
    },
]


def seed_permission_levels(db: Session) -> None:
    """Cria os 3 niveis do sistema se ainda nao existirem. Idempotente."""
    from app.models.permission import PermissionGrant, PermissionLevel

    for level_def in _SYSTEM_LEVELS:
        existing = db.query(PermissionLevel).filter(PermissionLevel.name == level_def["name"]).first()
        if not existing:
            level = PermissionLevel(
                name=level_def["name"],
                description=level_def["description"],
                is_system=True,
            )
            db.add(level)
            db.flush()
            for key in level_def["grants"]:
                db.add(PermissionGrant(level_id=level.id, permission_key=key))
    db.commit()


def get_user_permissions(db: Session, user_id: int) -> set[str]:
    """Retorna o conjunto de chaves de permissao do usuario.
    Platform admins (grupo Administradores) tem todas as permissoes automaticamente."""
    from app.core.workspace_deps import is_platform_admin
    from app.models.permission import PermissionGrant
    from app.models.user import User

    if is_platform_admin(db, user_id):
        return set(ALL_PERMISSIONS)

    user = db.query(User).get(user_id)
    if not user or not user.permission_level_id:
        return set()

    rows = db.query(PermissionGrant.permission_key).filter(
        PermissionGrant.level_id == user.permission_level_id
    ).all()
    return {r.permission_key for r in rows}


def has_permission(db: Session, user_id: int, key: str) -> bool:
    return key in get_user_permissions(db, user_id)
