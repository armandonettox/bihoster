"""Reverter acoes pela auditoria.

As rotas que alteram coisas gravam em `AuditLog.change` o estado de antes e de depois (JSON).
Reverter e voltar ao "antes", mas so se o estado atual ainda for o "depois": se alguem mudou a
mesma coisa em seguida, o servidor avisa (conflito) e so segue com confirmacao explicita.

Formatos de `change` (o campo `kind` escolhe o tratamento):

- workspace_update / report_update: {"fields": {campo: {"before": x, "after": y}}}
- access:            {"group_id", "group_name", "workspace_name", "before": papel|None, "after": papel|None}
- group_permissions: {"group_id", "group_name", "before": [chaves], "after": [chaves]}
- group_member:      {"group_id", "group_name", "user_id", "email", "before": bool, "after": bool}

Exclusoes, criacoes e configuracoes com segredo nao entram aqui: ficam sem `change` e a
auditoria as mostra como nao reversiveis.
"""

import json
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.permission_keys import MANAGED_PERMISSIONS
from app.core.workspace_deps import admin_group_lock
from app.models.audit_log import AuditLog
from app.models.group_permission import GroupPermission
from app.models.report import Report
from app.models.workspace import Group, GroupMember, GroupWorkspaceAccess, Workspace
from app.models.user import UserRole

WORKSPACE_UPDATE = "workspace_update"
REPORT_UPDATE = "report_update"
ACCESS = "access"
GROUP_PERMISSIONS = "group_permissions"
GROUP_MEMBER = "group_member"

SUPPORTED_KINDS = {WORKSPACE_UPDATE, REPORT_UPDATE, ACCESS, GROUP_PERMISSIONS, GROUP_MEMBER}

FIELD_LABELS = {
    "name": "nome",
    "description": "descricao",
    "icon": "icone",
    "color": "cor",
    "tv_interval_seconds": "tempo da TV (s)",
    "powerbi_connection_id": "conta do Power BI",
    "pbi_workspace_id": "workspace do Power BI",
    "pbi_report_id": "relatorio do Power BI",
    "pbi_dataset_id": "dataset do Power BI",
    "pbi_page_names": "abas exibidas",
    "pbi_page_name": "aba exibida",
    "display_type": "secao",
    "show_filter_pane": "painel de filtros",
    "show_page_nav": "navegacao entre paginas",
    "show_visual_header": "cabecalho dos visuais",
}
ROLE_LABELS = {"admin": "administrador", "editor": "editor", "viewer": "leitor", None: "sem acesso"}
# Campo do relatorio guardado a parte (lista de abas), restaurado por Report.set_page_names
PAGE_NAMES_FIELD = "pbi_page_names"


class RevertGone(Exception):
    """O item que a acao alterou nao existe mais (foi apagado depois)."""


class RevertBlocked(Exception):
    """Reverter quebraria uma regra de seguranca do sistema (ex: deixar a plataforma sem administrador)."""


def parse_change(raw: Optional[str]) -> Optional[dict]:
    """Le o JSON de `AuditLog.change`; devolve None se nao houver ou se nao for reversivel."""
    if not raw:
        return None
    try:
        change = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(change, dict) or change.get("kind") not in SUPPORTED_KINDS:
        return None
    return change


def changed_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """So os campos que de fato mudaram, no formato de workspace_update/report_update."""
    return {name: {"before": before[name], "after": after[name]} for name in after if before.get(name) != after[name]}


# --- texto legivel --------------------------------------------------------------------------


def _short(value: Any) -> str:
    if value is None or value == "":
        return "vazio"
    if isinstance(value, bool):
        return "sim" if value else "nao"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) or "nenhuma"
    text = str(value)
    return text if len(text) <= 60 else text[:57] + "..."


def describe_state(change: dict, value: Any) -> str:
    """Um estado (o "antes", o "depois" ou o atual) em palavras, para a confirmacao e o conflito."""
    kind = change["kind"]
    if kind in (WORKSPACE_UPDATE, REPORT_UPDATE):
        return "; ".join(f"{FIELD_LABELS.get(name, name)}: {_short(v)}" for name, v in value.items()) or "sem campos"
    if kind == ACCESS:
        return ROLE_LABELS.get(value, str(value))
    if kind == GROUP_PERMISSIONS:
        return _short(value)
    return "esta no grupo" if value else "fora do grupo"


def summarize(change: dict) -> str:
    """Frase da confirmacao: o que acontece se a acao for revertida."""
    kind = change["kind"]
    if kind in (WORKSPACE_UPDATE, REPORT_UPDATE):
        target = "da colecao" if kind == WORKSPACE_UPDATE else "do relatorio"
        parts = [
            f"{FIELD_LABELS.get(name, name)} volta de \"{_short(v['after'])}\" para \"{_short(v['before'])}\""
            for name, v in change["fields"].items()
        ]
        return f"Desfazer a edicao {target}: " + "; ".join(parts)
    if kind == ACCESS:
        return (
            f"Voltar o acesso do grupo \"{change['group_name']}\" a colecao \"{change['workspace_name']}\": "
            f"de {ROLE_LABELS.get(change['after'])} para {ROLE_LABELS.get(change['before'])}"
        )
    if kind == GROUP_PERMISSIONS:
        return (
            f"Voltar as permissoes do grupo \"{change['group_name']}\": de {_short(change['after'])} "
            f"para {_short(change['before'])}"
        )
    return f"Tirar {change['email']} do grupo \"{change['group_name']}\""


# --- estado atual e aplicacao -----------------------------------------------------------------


def expected_state(change: dict) -> Any:
    """O que o item deve estar valendo agora para a reversao ser segura (o "depois" da acao)."""
    if change["kind"] in (WORKSPACE_UPDATE, REPORT_UPDATE):
        return {name: v["after"] for name, v in change["fields"].items()}
    return change["after"]


def _report_for(db: Session, log: AuditLog) -> Report:
    report = db.query(Report).filter(Report.id == int(log.entity_id or 0)).first()
    if not report:
        raise RevertGone("O relatorio nao existe mais")
    return report


def _workspace_for(db: Session, log: AuditLog) -> Workspace:
    workspace = db.query(Workspace).filter(Workspace.id == (log.workspace_id or 0)).first()
    if not workspace:
        raise RevertGone("A colecao nao existe mais")
    return workspace


def current_state(db: Session, log: AuditLog, change: dict) -> Any:
    """Estado do item neste momento, no mesmo formato de `expected_state`."""
    kind = change["kind"]
    if kind == WORKSPACE_UPDATE:
        workspace = _workspace_for(db, log)
        return {name: getattr(workspace, name) for name in change["fields"]}
    if kind == REPORT_UPDATE:
        report = _report_for(db, log)
        return {
            name: report.pbi_page_names if name == PAGE_NAMES_FIELD else getattr(report, name)
            for name in change["fields"]
        }
    if kind == ACCESS:
        _workspace_for(db, log)
        if not db.query(Group).get(change["group_id"]):
            raise RevertGone("O grupo nao existe mais")
        access = (
            db.query(GroupWorkspaceAccess)
            .filter(GroupWorkspaceAccess.group_id == change["group_id"], GroupWorkspaceAccess.workspace_id == log.workspace_id)
            .first()
        )
        if not access:
            return None
        return access.role.value if hasattr(access.role, "value") else access.role
    if kind == GROUP_PERMISSIONS:
        if not db.query(Group).get(change["group_id"]):
            raise RevertGone("O grupo nao existe mais")
        rows = (
            db.query(GroupPermission.permission_key)
            .filter(GroupPermission.group_id == change["group_id"], GroupPermission.permission_key.in_(MANAGED_PERMISSIONS))
            .all()
        )
        return sorted(row.permission_key for row in rows)
    if not db.query(Group).get(change["group_id"]):
        raise RevertGone("O grupo nao existe mais")
    return (
        db.query(GroupMember)
        .filter(GroupMember.group_id == change["group_id"], GroupMember.user_id == change["user_id"])
        .first()
        is not None
    )


def apply_revert(db: Session, log: AuditLog, change: dict) -> None:
    """Volta o item ao "antes". Nao faz commit: quem chama grava junto a marca de revertido."""
    kind = change["kind"]
    if kind == WORKSPACE_UPDATE:
        workspace = _workspace_for(db, log)
        for name, v in change["fields"].items():
            setattr(workspace, name, v["before"])
    elif kind == REPORT_UPDATE:
        report = _report_for(db, log)
        for name, v in change["fields"].items():
            if name == PAGE_NAMES_FIELD:
                report.set_page_names(v["before"] or [])
            else:
                setattr(report, name, v["before"])
    elif kind == ACCESS:
        group_id, workspace_id, before = change["group_id"], log.workspace_id, change["before"]
        access = (
            db.query(GroupWorkspaceAccess)
            .filter(GroupWorkspaceAccess.group_id == group_id, GroupWorkspaceAccess.workspace_id == workspace_id)
            .first()
        )
        if before is None:
            if access:
                db.delete(access)
        elif access:
            access.role = UserRole(before)
        else:
            db.add(GroupWorkspaceAccess(group_id=group_id, workspace_id=workspace_id, role=UserRole(before)))
    elif kind == GROUP_PERMISSIONS:
        group = db.query(Group).get(change["group_id"])
        if group is not None and group.is_admin_group:
            raise RevertBlocked("O grupo Administradores sempre tem todas as permissoes")
        db.query(GroupPermission).filter(
            GroupPermission.group_id == change["group_id"], GroupPermission.permission_key.in_(MANAGED_PERMISSIONS)
        ).delete(synchronize_session=False)
        for key in change["before"]:
            db.add(GroupPermission(group_id=change["group_id"], permission_key=key))
    else:
        _remove_member(db, change)


def _remove_member(db: Session, change: dict) -> None:
    """Desfaz uma adicao ao grupo, com as mesmas travas da remocao normal de membro."""
    group = db.query(Group).get(change["group_id"])
    if group is None:
        raise RevertGone("O grupo nao existe mais")
    if group.is_default:
        raise RevertBlocked("Todo usuario cadastrado fica no grupo padrao")
    with admin_group_lock:
        if group.is_admin_group:
            if db.query(GroupMember).filter(GroupMember.group_id == group.id).count() <= 1:
                raise RevertBlocked("Nao e possivel remover o ultimo administrador da plataforma")
        member = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == group.id, GroupMember.user_id == change["user_id"])
            .first()
        )
        if member:
            db.delete(member)
            # Confirma ainda dentro do bloqueio, como a remocao normal: duas remocoes dos dois
            # ultimos administradores ao mesmo tempo nao podem passar juntas pela checagem
            db.commit()
