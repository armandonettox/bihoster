from typing import Optional

from pydantic import BaseModel

from app.schemas.types import UtcDatetime


class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int]
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    workspace_id: Optional[int]
    workspace_name: Optional[str] = None
    action: str
    # Nome da acao em portugues (o codigo continua em `action`)
    action_label: Optional[str] = None
    entity: str
    # Tipo de recurso em portugues (o termo tecnico continua em `entity`)
    entity_label: Optional[str] = None
    entity_id: Optional[str]
    details: Optional[str]
    created_at: UtcDatetime
    # Reversao pela auditoria: so as acoes que guardaram o estado de antes e ainda nao foram revertidas
    revertible: bool = False
    # O que acontece se a acao for revertida (texto da confirmacao)
    revert_summary: Optional[str] = None
    reverted_at: Optional[UtcDatetime] = None
    reverted_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class AuditRevertIn(BaseModel):
    # Segue mesmo que o item tenha sido alterado depois da acao (so apos a pessoa confirmar o aviso)
    force: bool = False


class AuditRevertOut(BaseModel):
    status: str = "reverted"
    summary: str


class AuditPageOut(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AuditActionOption(BaseModel):
    action: str
    label: str


class AuditEntityOption(BaseModel):
    entity: str
    label: str


class AuditUserOption(BaseModel):
    id: int
    name: str
    email: str
    # Detalhes mostrados no cartao ao passar o cursor no nome da pessoa
    is_platform_admin: bool = False
    groups: list[str] = []
    created_at: Optional[UtcDatetime] = None
    last_login_at: Optional[UtcDatetime] = None
    login_provider: str = "password"
    picture_url: Optional[str] = None


class AuditCollectionOption(BaseModel):
    id: int
    name: str


class AuditReportOption(BaseModel):
    id: int
    name: str
    collection: Optional[str] = None


class AuditOptionsOut(BaseModel):
    actions: list[AuditActionOption]
    entities: list[AuditEntityOption]
    users: list[AuditUserOption]
    collections: list[AuditCollectionOption]
    reports: list[AuditReportOption]


class AuditTotals(BaseModel):
    events: int
    active_users: int
    logins_ok: int
    logins_blocked: int
    accounts_locked: int


class AuditDayCount(BaseModel):
    date: str
    count: int


class AuditActionCount(BaseModel):
    action: str
    label: str
    count: int


class AuditUserCount(BaseModel):
    user_id: int
    name: str
    email: Optional[str] = None
    count: int


class AuditCollectionCount(BaseModel):
    workspace_id: int
    name: str
    visits: int


class AuditReportCount(BaseModel):
    report_id: str
    name: str
    collection: Optional[str] = None
    visits: int


class AuditLoginMethods(BaseModel):
    password: int
    google: int


class AuditSummaryOut(BaseModel):
    totals: AuditTotals
    by_day: list[AuditDayCount]
    # 24 posicoes, a hora no fuso configurado do sistema
    by_hour: list[int]
    by_action: list[AuditActionCount]
    top_users: list[AuditUserCount]
    top_collections: list[AuditCollectionCount]
    top_reports: list[AuditReportCount]
    login_methods: AuditLoginMethods
    timezone: str
