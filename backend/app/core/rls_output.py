"""Saida de relatorio com seguranca por linha (RLS), v1.55.0: e-mail (assinatura e envio avulso), exportacao em arquivo e Modo TV.

O chat de IA continua FORA: ele consulta com a Service Principal e a Microsoft diz que ela nao respeita RLS.

Regras (todas de falha fechada: na duvida, nada sai):
- A chave "Permitir saida de relatorio com RLS" (`app_settings.rls_output_enabled`) vem DESLIGADA. Desligada, o comportamento
  e o de sempre: relatorio com RLS nao sai por e-mail, arquivo nem TV.
- Ligada, a identidade de cada saida e a do DESTINATARIO (nunca a de quem criou ou pediu):
  * assinatura e envio avulso por e-mail: um arquivo por destinatario, com as funcoes dele; so quem tem conta no portal e pelo
    menos uma funcao mapeada recebe; os outros nao recebem nada;
  * exportacao em arquivo (PowerPoint, PDF, imagem): as funcoes de quem exporta, porque o arquivo e dele;
  * Modo TV: a funcao escolhida por quem monta a lista, limitada as que essa pessoa tem (e conferida de novo na hora de passar).
- Sem funcao mapeada no modelo, ou a pessoa sem nenhuma funcao, nao sai nada (nunca cai para "ve tudo").
- Cada saida com RLS vai para a auditoria com quem recebeu (id da pessoa) e as funcoes usadas."""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import dataset_security
from app.models.report import Report
from app.models.settings import AppSettings
from app.models.user import User

SWITCH_OFF_MESSAGE = (
    "Relatorios com seguranca por linha (RLS) so saem do sistema quando o administrador liga "
    "\"Permitir saida de relatorio com RLS\" em Administracao."
)


class RlsOutputBlocked(Exception):
    """O relatorio com RLS nao pode sair desta forma, para esta pessoa. A mensagem e para a tela."""


@dataclass(frozen=True)
class OutputIdentity:
    user_id: int
    email: str
    username: str
    roles: tuple[str, ...]
    dataset_id: str

    def as_export_identity(self) -> dict:
        """No formato `identities` do ExportTo do Power BI."""
        return {"username": self.username, "roles": list(self.roles), "datasets": [self.dataset_id]}

    def audit_text(self) -> str:
        return f"usuario {self.user_id}: {', '.join(self.roles)}"


def switch_on(db: Session) -> bool:
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    return bool(row and row.rls_output_enabled)


def identity_for_user(db: Session, user: User, report: Report, *, who: str = "Voce") -> OutputIdentity:
    """A identidade com que o relatorio (que tem RLS) sai para esta pessoa. Levanta RlsOutputBlocked quando nao pode."""
    if not switch_on(db):
        raise RlsOutputBlocked(SWITCH_OFF_MESSAGE)
    if not report.pbi_dataset_id:
        raise RlsOutputBlocked("O relatorio nao tem modelo semantico conhecido, entao a seguranca por linha nao pode ser aplicada.")
    try:
        identity = dataset_security.resolve_identity(db, user, report)
    except dataset_security.RlsRoleRequired:
        raise RlsOutputBlocked(f"{who} nao tem uma funcao de seguranca neste relatorio, entao ele nao pode sair.") from None
    if identity is None:
        raise RlsOutputBlocked("O modelo deste relatorio nao tem funcoes de seguranca mapeadas, entao ele nao pode sair.")
    return OutputIdentity(user.id, user.email, identity.username, tuple(identity.roles), report.pbi_dataset_id)


def user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(func.lower(User.email) == (email or "").strip().lower()).first()


def identities_for_recipients(db: Session, report: Report, emails: list[str]) -> tuple[list[tuple[str, OutputIdentity]], list[str]]:
    """Para cada destinatario com conta e funcao, (e-mail, identidade). Devolve tambem os motivos de quem ficou de fora, sem
    o endereco (so a contagem e o motivo): destinatario sem conta no portal ou sem funcao nao recebe nada."""
    deliverable: list[tuple[str, OutputIdentity]] = []
    skipped: list[str] = []
    if not switch_on(db):
        return [], [SWITCH_OFF_MESSAGE]
    for email in emails:
        user = user_by_email(db, email)
        if user is None:
            skipped.append("destinatario sem conta no portal")
            continue
        try:
            deliverable.append((email, identity_for_user(db, user, report, who="O destinatario")))
        except RlsOutputBlocked as exc:
            skipped.append(str(exc))
    return deliverable, skipped


def audit_details(identities: list[OutputIdentity], skipped: int = 0) -> str:
    text = "; ".join(item.audit_text() for item in identities) or "ninguem"
    if skipped:
        text += f" | {skipped} destinatario(s) sem saida"
    return text[:480]


def roles_held_by(db: Session, user: User, report: Report) -> list[str]:
    """As funcoes que a pessoa tem neste relatorio (vazio se o modelo nao tem mapeamento ou nao e conhecido)."""
    dataset = dataset_security.dataset_of_report(db, report)
    if dataset is None:
        return []
    return dataset_security.roles_for_user(db, user.id, dataset.id)
