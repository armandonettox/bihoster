from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator

from app.core.access_catalog import CATALOG, scope_of, with_implied


class PermissionOut(BaseModel):
    key: str
    label: str
    description: str
    scope: str
    section: str
    # Grupo de itens a que pertence (a tela mostra um interruptor-mestre por grupo) e o que precisa estar ligado junto
    feature: str | None = None
    feature_label: str | None = None
    feature_description: str | None = None
    requires: list[str] = []


class CatalogOut(BaseModel):
    permissions: list[PermissionOut]
    presets: dict[str, list[str]]


class GrantBlock(BaseModel):
    """Permissoes num escopo: workspace_id vazio e global, preenchido e a colecao."""

    workspace_id: int | None = None
    permissions: list[str]

    @model_validator(mode="after")
    def check_scope(self):
        scope = "workspace" if self.workspace_id is not None else "global"
        for key in self.permissions:
            key_scope = scope_of(key)
            if key_scope is None:
                raise ValueError(f"Permissao invalida: {key}")
            if key_scope != scope:
                where = "de uma colecao" if key_scope == "workspace" else "global"
                raise ValueError(f"A permissao {key} e {where} e foi enviada no escopo errado")
        self.permissions = with_implied(self.permissions)
        return self


class GrantsOut(BaseModel):
    blocks: list[GrantBlock]
    # False no grupo Administradores: ele tem todas as permissoes sempre
    editable: bool


class GroupGrantsOut(BaseModel):
    group_id: int
    blocks: list[GrantBlock]
    # False no grupo Administradores: ele tem todas as permissões sempre
    editable: bool


class GroupsGrantsOut(BaseModel):
    groups: list[GroupGrantsOut]


class GrantsUpdate(BaseModel):
    blocks: list[GrantBlock]

    @model_validator(mode="after")
    def no_repeated_scope(self):
        seen: set[int | None] = set()
        for block in self.blocks:
            if block.workspace_id in seen:
                raise ValueError("Escopo repetido na lista de permissoes")
            seen.add(block.workspace_id)
        return self


class GrantsByEmail(GrantsUpdate):
    """Permissões avulsas para uma pessoa pelo e-mail: aplicadas na hora se ela já tem conta, ou reservadas no
    convite se ainda não tem."""

    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class ByEmailOut(BaseModel):
    # "applied": a pessoa já tem conta e recebeu as permissões. "pending": ficam reservadas no convite.
    status: str


class ReportGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    is_default: bool


class ReportPermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    # Grupos de onde a permissão vem e se também foi dada direto à pessoa
    groups: list[str]
    direct: bool


class ReportRowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    name: str
    email: str
    is_admin: bool
    groups: list[ReportGroupOut]
    workspace_id: int | None
    scope_label: str
    permissions: list[ReportPermissionOut]


class AccessReportOut(BaseModel):
    rows: list[ReportRowOut]


class MyAccessOut(BaseModel):
    is_admin: bool
    global_permissions: list[str]
    workspace_permissions: dict[int, list[str]]
    # O que a pessoa recebeu direto em cada relatorio (id do relatorio para as chaves); o que vem da colecao esta em workspace_permissions
    report_permissions: dict[int, list[str]] = {}
    # Cria TVs ou tem acesso a alguma: mostra o modulo Modo TV (o acesso de cada TV e por TV, nao entra nas listas acima)
    tv_access: bool = False


def catalog_out(presets: dict[str, tuple[str, ...]]) -> CatalogOut:
    return CatalogOut(
        permissions=[
            PermissionOut(
                key=p.key,
                label=p.label,
                description=p.description,
                scope=p.scope,
                section=p.section,
                feature=p.feature,
                feature_label=p.feature_label,
                feature_description=p.feature_description,
                requires=list(p.requires),
            )
            # Os itens que so existem num relatorio ficam de fora: o editor de colecoes e globais nao os conhece (ver /access/reports/catalog)
            for p in CATALOG
            if p.scope in ("workspace", "global")
        ],
        presets={name: list(keys) for name, keys in presets.items()},
    )
