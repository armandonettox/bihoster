from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.user import UserRole

# Campos que sao NOT NULL no banco (Workspace) -- um cliente mandando explicitamente
# {"campo": null} deve dar 422, nao quebrar com IntegrityError no commit.
_WORKSPACE_NOT_NULLABLE_FIELDS = ("name", "tv_interval_seconds")


class WorkspaceCreate(BaseModel):
    name: str = Field(max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    icon: Optional[str] = None
    color: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nome da colecao nao pode ser vazio")
        return value


class WorkspaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    icon: Optional[str] = None
    color: Optional[str] = None
    tv_interval_seconds: Optional[int] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Nome da colecao nao pode ser vazio")
        return value

    @field_validator("tv_interval_seconds")
    @classmethod
    def interval_valid(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and (value < 3 or value > 3600):
            raise ValueError("Tempo deve ser entre 3 e 3600 segundos")
        return value

    @model_validator(mode="after")
    def reject_explicit_null_on_required_fields(self) -> "WorkspaceUpdate":
        for field_name in _WORKSPACE_NOT_NULLABLE_FIELDS:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"O campo '{field_name}' nao pode ser nulo")
        return self


class WorkspaceOut(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    tv_interval_seconds: int = 15
    role: UserRole

    class Config:
        from_attributes = True


class GroupCreate(BaseModel):
    name: str = Field(max_length=200)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Nome do grupo nao pode ser vazio")
        return value


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Nome do grupo nao pode ser vazio")
        return value


class GroupOut(BaseModel):
    id: int
    name: str
    is_default: bool
    is_admin_group: bool

    class Config:
        from_attributes = True


class GroupMemberAdd(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class GroupMemberOut(BaseModel):
    user_id: int
    name: str
    email: str


class GroupInviteOut(BaseModel):
    id: int
    email: str
    group_id: int

    class Config:
        from_attributes = True


class AccessUpdate(BaseModel):
    role: UserRole

    @field_validator("role")
    @classmethod
    def no_admin_via_matrix(cls, value: UserRole) -> UserRole:
        if value == UserRole.admin:
            raise ValueError("Admin de colecao so existe via o grupo Administradores, nao pela matriz de acesso")
        return value


class WorkspaceAccessOut(BaseModel):
    group_id: int
    group_name: str
    is_default: bool
    is_admin_group: bool
    role: Optional[UserRole]
