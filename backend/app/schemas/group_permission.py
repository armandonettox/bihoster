from pydantic import BaseModel


class AIAccessOut(BaseModel):
    can_manage: bool
    can_use: bool
    # Cada item de IA que a pessoa tem (ia.usar, ia.chaves, ...): a tela usa para mostrar só o que ela pode mexer
    permissions: list[str] = []


class AnalyticsAccessOut(BaseModel):
    can_view: bool
    can_create: bool
    can_edit: bool
    can_delete: bool
