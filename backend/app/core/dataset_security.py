"""Seguranca por linha e por objeto (RLS e OLS) mapeada por grupo e por pessoa, por modelo semantico.

No Power BI o OLS se define nas mesmas funcoes do RLS, entao mandar a funcao certa no token cobre os dois. O portal nao cria
nem altera funcoes: quem configura digita o nome da funcao que existe no modelo.

Regras:
- So vale para um modelo que tem mapeamento. Sem nenhuma linha em dataset_role_grants, nada muda: o token continua levando
  so o e-mail da pessoa, como antes.
- Com mapeamento, a pessoa recebe a uniao das funcoes dos grupos dela e das dadas a ela. Sem nenhuma funcao, o relatorio
  NAO abre (falha fechada): nunca cai para "ve tudo".
- Mudou grupo ou mapeamento: o token anterior nao serve mais, porque as funcoes fazem parte da chave do cache."""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.report import Report
from app.models.user import User
from app.models.workspace import GroupMember

# Nome de usuario do token compartilhado por conjunto de funcoes: nao e de ninguem. Uma regra que dependa de USERNAME()
# enxerga ninguem (nenhuma linha), nunca os dados de outra pessoa.
SHARED_USERNAME = "bihoster-funcoes"

MAX_ROLE_LENGTH = 200


class RlsRoleRequired(Exception):
    """O modelo tem funcoes mapeadas e a pessoa nao recebeu nenhuma."""


@dataclass(frozen=True)
class EmbedIdentity:
    username: str
    roles: tuple[str, ...]
    # Token dividido entre as pessoas com o mesmo conjunto de funcoes (so em modelo marcado como "RLS so por funcao")
    shared: bool

    def cache_part(self, user_id: int) -> tuple:
        """Terceiro item da chave do cache de embed. Leva as funcoes: se elas mudam, a chave muda."""
        return ("m", 0 if self.shared else user_id, self.roles)


def dataset_of_report(db: Session, report: Report) -> PbiDataset | None:
    """O modelo do relatorio, se a sincronizacao do catalogo ja o trouxe (conta + workspace + id do modelo)."""
    if not report.powerbi_connection_id or not report.pbi_dataset_id:
        return None
    return (
        db.query(PbiDataset)
        .filter(
            PbiDataset.connection_id == report.powerbi_connection_id,
            PbiDataset.pbi_workspace_id == report.pbi_workspace_id,
            PbiDataset.pbi_dataset_id == report.pbi_dataset_id,
        )
        .first()
    )


def has_mapping(db: Session, report: Report) -> bool:
    """O modelo do relatorio tem alguma funcao mapeada? E a unica consulta do caminho de hoje (sem mapeamento)."""
    dataset = dataset_of_report(db, report)
    if dataset is None:
        return False
    return db.query(DatasetRoleGrant.id).filter(DatasetRoleGrant.dataset_id == dataset.id).first() is not None


def roles_for_user(db: Session, user_id: int, dataset_id: int) -> list[str]:
    """A uniao das funcoes dos grupos da pessoa e das dadas a ela, sem repetidas e em ordem."""
    my_groups = db.query(GroupMember.group_id).filter(GroupMember.user_id == user_id)
    rows = (
        db.query(DatasetRoleGrant.pbi_role)
        .filter(
            DatasetRoleGrant.dataset_id == dataset_id,
            (DatasetRoleGrant.user_id == user_id) | (DatasetRoleGrant.group_id.in_(my_groups)),
        )
        .all()
    )
    return sorted({row[0] for row in rows})


def resolve_identity(db: Session, user: User, report: Report) -> EmbedIdentity | None:
    """A identidade do token para esta pessoa neste relatorio. None = o modelo nao tem mapeamento (vale o caminho de hoje).
    Levanta RlsRoleRequired quando ha mapeamento e a pessoa nao tem funcao nenhuma."""
    dataset = dataset_of_report(db, report)
    if dataset is None:
        return None
    if db.query(DatasetRoleGrant.id).filter(DatasetRoleGrant.dataset_id == dataset.id).first() is None:
        return None
    roles = roles_for_user(db, user.id, dataset.id)
    if not roles:
        raise RlsRoleRequired()
    shared = bool(dataset.rls_shared_by_roles)
    return EmbedIdentity(username=SHARED_USERNAME if shared else user.email, roles=tuple(roles), shared=shared)


def clean_role(value: str) -> str:
    """Nome de funcao digitado: sem espacos nas pontas, nao vazio, com tamanho razoavel e sem caractere de controle."""
    role = (value or "").strip()
    if not role or len(role) > MAX_ROLE_LENGTH or any(ord(ch) < 32 for ch in role):
        raise ValueError("Nome de funcao invalido")
    return role
