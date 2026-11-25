"""A colecao interna "Raiz": onde ficam os relatorios importados do tenant do Power BI.

Ela e uma colecao de verdade no banco (reports.collection_id continua obrigatorio), mas o sistema
a trata de forma especial: nao aparece nas listas de colecoes, nao recebe o acesso padrao do grupo
"Todos os usuarios", nasce sem nenhuma concessao e nao pode ser editada nem excluida. Como o acesso
ainda e por colecao nesta fase, isso garante que o que foi importado nao vaza para ninguem."""

from sqlalchemy.orm import Session

from app.models.workspace import Workspace

ROOT_KEY = "root"
ROOT_NAME = "Raiz"


def ensure_root_collection(db: Session) -> Workspace:
    """Cria a Raiz se ainda nao existir (idempotente, seguro de rodar a cada boot)."""
    root = db.query(Workspace).filter(Workspace.system_key == ROOT_KEY).first()
    if root is not None:
        return root

    slug = "raiz"
    counter = 2
    while db.query(Workspace).filter(Workspace.slug == slug).first():
        slug = f"raiz-{counter}"
        counter += 1
    root = Workspace(
        name=ROOT_NAME,
        slug=slug,
        description="Relatorios importados do Power BI. So administradores veem.",
        system_key=ROOT_KEY,
    )
    db.add(root)
    db.commit()
    db.refresh(root)
    return root


def get_root_collection(db: Session) -> Workspace:
    return ensure_root_collection(db)


def is_system_workspace(workspace: Workspace | None) -> bool:
    return workspace is not None and workspace.system_key is not None
