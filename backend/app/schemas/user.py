from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    name: str = Field(max_length=200)
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("password")
    @classmethod
    def password_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Senha deve ter pelo menos 8 caracteres")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Senha muito longa (maximo 72 bytes)")
        return value


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class GoogleLogin(BaseModel):
    id_token: str


class ResetPassword(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Senha deve ter pelo menos 8 caracteres")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Senha muito longa (maximo 72 bytes)")
        return value


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    is_platform_admin: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
