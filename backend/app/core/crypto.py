import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import String, TypeDecorator

from app.core.config import settings


def _derive_fernet_key(raw_key: str) -> bytes:
    """Fernet exige uma chave de 32 bytes url-safe base64 -- deriva isso de qualquer string
    via SHA-256, pra ENCRYPTION_KEY poder ser uma senha/frase normal no .env."""
    digest = hashlib.sha256(raw_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_fernet_key(settings.encryption_key))


class EncryptedString(TypeDecorator):
    """Coluna de texto cifrada em repouso com Fernet (AES-128-CBC + HMAC).

    Le valores legados gravados antes dessa migracao (texto puro) sem quebrar -- se a
    descriptografia falhar por nao ser um token Fernet valido, devolve o valor cru como
    esta. Na proxima gravacao desse registro, o valor ja sai cifrado.

    LIMITACAO CONHECIDA: essa mesma logica de fallback nao distingue "nunca foi cifrado"
    de "foi cifrado com uma ENCRYPTION_KEY diferente da atual" -- rotacionar a chave sem
    antes reescrever os registros existentes (descriptografar com a chave antiga, gravar
    de novo com a nova) faz esses campos virarem lixo ilegivel, usado como se fosse o
    client_secret real (falha confusa no Power BI/Google em vez de um erro claro aqui).
    Se um dia precisar rotacionar ENCRYPTION_KEY, faca isso manualmente antes de trocar
    a variavel de ambiente.
    """

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return _fernet.encrypt(value.encode()).decode()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return _fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            return value
