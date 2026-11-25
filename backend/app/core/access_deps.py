"""Verificações de permissão para as rotas: "esta pessoa pode fazer isto?", pelo item do catálogo.

Duas formas, conforme o escopo do item:
- `require_workspace_permission("relatorio.publicar")` para rotas de uma coleção (pega o `workspace_id` do caminho);
- `require_global_permission("membros.adicionar")` para rotas do sistema todo.

Quem é do grupo Administradores passa em todas. Nenhuma permissão dá o papel de administrador da plataforma (L-314),
então a rota que exige ser administrador de verdade continua usando `require_platform_admin`.

O nome do item é conferido quando a rota é declarada: um erro de digitação ou um item do escopo errado quebra na
hora de subir o servidor, não em silêncio na hora de alguém usar."""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import access_catalog
from app.core.access_engine import can_global, can_in_workspace, effective_access, folders_of_report
from app.core.report_lookup import report_in_workspace
from app.core.report_schedule import GATED_KEYS, ensure_report_open
from app.core.database import get_db
from app.models.report import Report
from app.models.user import User
from app.routers.auth import get_current_user

DENIED_WORKSPACE = "Voce nao tem permissao para essa acao nesta colecao"
DENIED_GLOBAL = "Voce nao tem permissao para essa acao"


def _checked(key: str, scope: str) -> str:
    permission = access_catalog.get(key)
    if permission is None:
        raise ValueError(f"Permissao desconhecida: {key}")
    if permission.scope != scope:
        raise ValueError(f"A permissao {key} e de escopo {permission.scope}, nao {scope}")
    return key


def require_workspace_permission(key: str):
    _checked(key, access_catalog.WORKSPACE)

    def dependency(
        workspace_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not can_in_workspace(db, current_user.id, key, workspace_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_WORKSPACE)
        return current_user

    return dependency


def require_report_permission(key: str):
    """Para as rotas de um relatorio (`/workspaces/{workspace_id}/.../reports/{report_id}/...`): passa quem tem o item
    nesse relatorio, seja por permissao dada direto nele, seja pela colecao em que ele esta. `relatorio.ver` equivale a
    "ver a colecao" quando a permissao vem da colecao. O relatorio precisa mesmo estar na colecao do caminho.

    Quem so recebeu um relatorio nao passa nas rotas da colecao (que continuam exigindo a colecao): ela nao enxerga os
    outros relatorios dela."""
    permission = access_catalog.get(key)
    if permission is None or key not in access_catalog.REPORT_CAPABLE:
        raise ValueError(f"A permissao {key} nao vale num relatorio")
    # Se o relatorio nao existe, a resposta e a mesma de antes: so quem tem o item na colecao chega ao 404
    workspace_key = access_catalog.COLLECTION_VIEW if key == access_catalog.REPORT_VIEW else key

    def dependency(
        workspace_id: int,
        report_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        access = effective_access(db, current_user.id)
        report = db.query(Report).filter(Report.id == report_id, report_in_workspace(workspace_id)).first()
        if report is None:
            allowed = access.has_in_workspace(workspace_key, workspace_id)
        else:
            allowed = access.has_in_report(key, report.id, report.collection_id, folders_of_report(db, report.id))
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_WORKSPACE)
        # Horario de acesso do relatorio: so abrir e exportar dependem dele (import aqui: evita circular)
        if report is not None and key in GATED_KEYS:
            ensure_report_open(db, current_user, report.id)
        return current_user

    return dependency


def require_connection_permission(key: str):
    """Para as rotas de uma conta do Power BI (`/powerbi-connections/{connection_id}/...`): passa quem tem o item nessa conta,
    seja por permissao dada direto nela, seja pela permissao geral. Quem nao passa recebe 403 antes de qualquer consulta."""
    if key not in access_catalog.CONNECTION_CAPABLE:
        raise ValueError(f"A permissao {key} nao vale numa conta")

    def dependency(
        connection_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not effective_access(db, current_user.id).has_in_connection(key, connection_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_GLOBAL)
        return current_user

    return dependency


def require_dataset_permission(key: str):
    """Para as rotas de um modelo semantico (`.../datasets/{dataset_id}/...`): passa quem tem o item nesse modelo, seja por
    permissao dada direto nele, seja pelas permissoes gerais (`modelo.seguranca` geral vale em todos; `modelo.catalogo`
    da "ver"). Quem nao passa recebe 403 antes de qualquer consulta ao modelo, igual a um modelo que nao existe."""
    if key not in access_catalog.DATASET_CAPABLE:
        raise ValueError(f"A permissao {key} nao vale num modelo")

    def dependency(
        dataset_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not effective_access(db, current_user.id).has_in_dataset(key, dataset_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_GLOBAL)
        return current_user

    return dependency


def require_global_permission(key: str):
    _checked(key, access_catalog.GLOBAL)

    def dependency(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not can_global(db, current_user.id, key):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_GLOBAL)
        return current_user

    return dependency


def require_any_workspace_permission(*keys: str):
    """Para rotas que não são de uma coleção em particular (como a lista do Power BI na hora de cadastrar um relatório):
    passa quem tem ao menos um destes itens em alguma coleção."""
    for key in keys:
        _checked(key, access_catalog.WORKSPACE)

    def dependency(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        access = effective_access(db, current_user.id)
        if not access.is_admin and not any(access.workspace_ids_with(key) for key in keys):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_GLOBAL)
        return current_user

    return dependency


def require_any_global_permission(*keys: str):
    """Para rotas que servem a mais de uma área (a lista de permissões serve a Membros e a Grupos): passa quem tem ao
    menos um destes itens."""
    for key in keys:
        _checked(key, access_catalog.GLOBAL)

    def dependency(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ) -> User:
        access = effective_access(db, current_user.id)
        if not any(access.has_global(key) for key in keys):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED_GLOBAL)
        return current_user

    return dependency
