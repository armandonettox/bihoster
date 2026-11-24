"""Modo TV: cadastro das TVs (com o que passa em cada uma e quem pode ver ou mexer) e a entrada da propria TV.

Duas partes:
- `router` (/tvs): para a pessoa logada. Ver (e utilizar) e modificar sao por TV (core/tv_access.py); criar TV e a
  permissao geral `tv.criar`.
- `player_router` (/tv-player): para a TV, sem login. Ela abre o link secreto, digita o codigo que muda com o tempo
  (core/tv.py) e recebe um token proprio, que so serve para ler a lista dela e os embeds dos relatorios dessa lista."""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core import powerbi, tv as tv_core, tv_access
from app.core.access_deps import require_global_permission
from app.core.access_engine import effective_access
from app.core.audit import log_action
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.report import Report
from app.models.tv import Tv, TvGrant, TvItem
from app.models.user import User
from app.models.workspace import Group, Workspace
from app.routers import powerbi as embed_router
from app.routers.auth import get_current_user
from app.schemas.powerbi import EmbedConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tvs", tags=["tv"])
player_router = APIRouter(prefix="/tv-player", tags=["tv-player"])

TV_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads" / "tv"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MIN_SECONDS = 3
MAX_SECONDS = 3600
MAX_ITEMS = 100
# A TV conta como "ligada" se pediu a lista nos ultimos minutos (ela confere a lista a cada 3)
ONLINE_WINDOW = timedelta(minutes=8)

ItemKind = Literal["report_page", "image", "youtube"]


# --- Entradas e saidas -----------------------------------------------------------------------------------------------


class ItemIn(BaseModel):
    kind: ItemKind
    seconds: int = Field(ge=MIN_SECONDS, le=MAX_SECONDS)
    report_id: Optional[int] = None
    page_name: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    sound: bool = False


class ItemsIn(BaseModel):
    items: list[ItemIn] = Field(max_length=MAX_ITEMS)


class ItemOut(BaseModel):
    id: int
    kind: ItemKind
    seconds: int
    report_id: Optional[int] = None
    report_name: Optional[str] = None
    collection_name: Optional[str] = None
    page_name: Optional[str] = None
    page_title: Optional[str] = None
    image_url: Optional[str] = None
    video_id: Optional[str] = None
    sound: bool = False


class TvCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome da TV")
        return value


class TvUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    # Vazio (null) = a TV fica conectada para sempre
    session_hours: Optional[int] = Field(default=None, ge=tv_core.MIN_SESSION_HOURS, le=tv_core.MAX_SESSION_HOURS)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome da TV")
        return value


class TvSummary(BaseModel):
    id: int
    name: str
    level: Literal["ver", "modificar"]
    items_count: int
    total_seconds: int
    session_hours: Optional[int]
    online: bool
    last_seen_at: Optional[datetime]


class TvOut(TvSummary):
    link_secret: str
    items: list[ItemOut]


class CodeOut(BaseModel):
    code: str
    expires_in_seconds: int
    step_seconds: int = tv_core.CODE_STEP_SECONDS


class GrantIn(BaseModel):
    user_id: Optional[int] = None
    group_id: Optional[int] = None
    level: Literal["ver", "modificar"]


class GrantsIn(BaseModel):
    grants: list[GrantIn] = Field(max_length=500)


class GrantOut(BaseModel):
    user_id: Optional[int] = None
    group_id: Optional[int] = None
    name: str
    level: Literal["ver", "modificar"]


class PersonOut(BaseModel):
    id: int
    name: str
    email: Optional[str] = None


class PeopleOut(BaseModel):
    users: list[PersonOut]
    groups: list[PersonOut]


class ReportChoice(BaseModel):
    id: int
    name: str
    collection_id: int
    collection_name: str


class PageChoice(BaseModel):
    name: str
    title: str


class ConnectIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class ConnectOut(BaseModel):
    token: str
    expires_at: Optional[datetime] = None
    name: str


class PlayerItem(BaseModel):
    id: int
    kind: ItemKind
    seconds: int
    report_name: Optional[str] = None
    page_name: Optional[str] = None
    image_url: Optional[str] = None
    video_id: Optional[str] = None
    sound: bool = False


class PlaylistOut(BaseModel):
    name: str
    items: list[PlayerItem]


# --- Apoio -----------------------------------------------------------------------------------------------------------


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _is_online(tv: Tv) -> bool:
    seen = _utc(tv.last_seen_at)
    return seen is not None and datetime.now(timezone.utc) - seen < ONLINE_WINDOW


def _summary(tv: Tv, level: str) -> dict:
    return {
        "id": tv.id,
        "name": tv.name,
        "level": level,
        "items_count": len(tv.items),
        "total_seconds": sum(item.seconds for item in tv.items),
        "session_hours": tv.session_hours,
        "online": _is_online(tv),
        "last_seen_at": _utc(tv.last_seen_at),
    }


def _item_out(db: Session, item: TvItem) -> ItemOut:
    report = db.query(Report).get(item.report_id) if item.report_id else None
    collection = db.query(Workspace).get(report.collection_id) if report else None
    return ItemOut(
        id=item.id,
        kind=item.kind,
        seconds=item.seconds,
        report_id=item.report_id,
        report_name=report.name if report else None,
        collection_name=collection.name if collection else None,
        page_name=item.page_name,
        image_url=item.image_url,
        video_id=item.video_id,
        sound=bool(item.sound),
    )


def _tv_out(db: Session, tv: Tv, level: str) -> TvOut:
    return TvOut(**_summary(tv, level), link_secret=tv.link_secret, items=[_item_out(db, i) for i in tv.items])


def _get_tv(db: Session, tv_id: int) -> Tv:
    tv = db.query(Tv).get(tv_id)
    if tv is None:
        raise HTTPException(status_code=404, detail="TV nao encontrada")
    return tv


def _require_level(db: Session, user: User, tv_id: int, needed: str) -> tuple[Tv, str]:
    """A TV e o nivel da pessoa nela. Quem nao enxerga a TV recebe 404 (nao revela que ela existe); quem enxerga mas
    nao pode o que pediu recebe 403."""
    tv = _get_tv(db, tv_id)
    level = tv_access.level_in_tv(db, user.id, tv_id)
    if level is None:
        raise HTTPException(status_code=404, detail="TV nao encontrada")
    if needed == tv_access.MODIFY and level != tv_access.MODIFY:
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para modificar esta TV")
    return tv, level


def _remove_image_file(url: Optional[str]) -> None:
    if not url or not url.startswith("/static/uploads/tv/"):
        return
    try:
        (TV_UPLOAD_DIR / url.removeprefix("/static/uploads/tv/")).unlink(missing_ok=True)
    except OSError:
        pass


def _sniff_image(head: bytes) -> Optional[str]:
    """A extensao certa pelo conteudo do arquivo, nao pelo tipo que o navegador disse: so PNG, JPG, GIF e WebP."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def _visible_workspace_ids(db: Session, user: User) -> Optional[set[int]]:
    """As colecoes que a pessoa ve; None = todas (administrador)."""
    access = effective_access(db, user.id)
    if access.is_admin:
        return None
    return access.workspace_ids_with("colecao.ver")


def _is_rls(db: Session, report: Report) -> bool:
    connection = embed_router._get_connection_or_error(db, report)
    static = embed_router._get_report_static(connection, report.collection_id, report)
    return bool(static["needs_identity"])


def _audit(db: Session, user: Optional[User], action: str, tv: Tv, details: Optional[str] = None) -> None:
    log_action(db, action=action, entity="tv", user_id=user.id if user else None, entity_id=str(tv.id), details=details or tv.name)


# --- Rotas da pessoa logada ------------------------------------------------------------------------------------------


@router.get("", response_model=list[TvSummary])
def list_tvs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    levels = tv_access.levels_for_user(db, current_user.id)
    if not levels:
        return []
    tvs = db.query(Tv).filter(Tv.id.in_(levels)).order_by(Tv.name).all()
    return [_summary(tv, levels[tv.id]) for tv in tvs]


@router.post("", response_model=TvOut, status_code=201)
def create_tv(
    data: TvCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_global_permission(tv_access.CREATE_KEY)),
):
    tv = Tv(name=data.name, link_secret=tv_core.new_secret(), code_secret=tv_core.new_secret(), created_by=current_user.id)
    db.add(tv)
    db.flush()
    # Quem cria a TV pode modificar ela (senao criaria algo que nao consegue abrir)
    db.add(TvGrant(tv_id=tv.id, user_id=current_user.id, level=tv_access.MODIFY))
    db.commit()
    db.refresh(tv)
    _audit(db, current_user, "create_tv", tv)
    return _tv_out(db, tv, tv_access.MODIFY)


@router.get("/people", response_model=PeopleOut)
def list_people(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Pessoas e grupos para escolher quem acessa uma TV. So para quem pode modificar alguma TV."""
    levels = tv_access.levels_for_user(db, current_user.id)
    if tv_access.MODIFY not in levels.values():
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para essa acao")
    users = db.query(User).order_by(User.email).all()
    groups = db.query(Group).order_by(Group.name).all()
    return PeopleOut(
        users=[PersonOut(id=u.id, name=u.name or u.email, email=u.email) for u in users],
        groups=[PersonOut(id=g.id, name=g.name) for g in groups],
    )


@router.get("/available-reports", response_model=list[ReportChoice])
def available_reports(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Os relatorios que a pessoa pode colocar numa TV: os das colecoes que ela ve. Quem so olha uma TV nao monta lista."""
    levels = tv_access.levels_for_user(db, current_user.id)
    if tv_access.MODIFY not in levels.values() and not tv_access.can_create(db, current_user.id):
        raise HTTPException(status_code=403, detail="Voce nao tem permissao para essa acao")
    visible = _visible_workspace_ids(db, current_user)
    query = db.query(Report, Workspace).join(Workspace, Workspace.id == Report.collection_id)
    if visible is not None:
        query = query.filter(Report.collection_id.in_(visible or {-1}))
    rows = query.order_by(Workspace.name, Report.name).all()
    return [ReportChoice(id=r.id, name=r.name, collection_id=w.id, collection_name=w.name) for r, w in rows]


@router.get("/report-pages/{report_id}", response_model=list[PageChoice])
def report_pages(report_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """As paginas de um relatorio, para escolher qual passa na TV (so as escolhidas para o relatorio, se houver)."""
    report = db.query(Report).get(report_id)
    visible = _visible_workspace_ids(db, current_user)
    if report is None or (visible is not None and report.collection_id not in visible):
        raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
    connection = embed_router._get_connection_or_error(db, report)
    pages = powerbi.list_pages(embed_router._connection_snapshot(connection), report.pbi_workspace_id, report.pbi_report_id)
    allowed = list(report.pbi_page_names or [])
    return [
        PageChoice(name=p["name"], title=p.get("displayName") or p["name"])
        for p in pages
        if not allowed or p["name"] in allowed
    ]


@router.get("/{tv_id}", response_model=TvOut)
def get_tv(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, level = _require_level(db, current_user, tv_id, tv_access.VIEW)
    return _tv_out(db, tv, level)


@router.put("/{tv_id}", response_model=TvOut)
def update_tv(tv_id: int, data: TvUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, level = _require_level(db, current_user, tv_id, tv_access.MODIFY)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        tv.name = changes["name"]
    if "session_hours" in changes:
        tv.session_hours = changes["session_hours"]
    db.commit()
    db.refresh(tv)
    _audit(db, current_user, "update_tv", tv)
    return _tv_out(db, tv, level)


@router.delete("/{tv_id}", status_code=204)
def delete_tv(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, _ = _require_level(db, current_user, tv_id, tv_access.MODIFY)
    images = [item.image_url for item in tv.items if item.image_url]
    name = tv.name
    db.delete(tv)
    db.commit()
    for url in images:
        _remove_image_file(url)
    log_action(db, action="delete_tv", entity="tv", user_id=current_user.id, entity_id=str(tv_id), details=name)


@router.put("/{tv_id}/items", response_model=TvOut)
def replace_items(tv_id: int, data: ItemsIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, level = _require_level(db, current_user, tv_id, tv_access.MODIFY)
    already = {item.report_id for item in tv.items if item.report_id}
    visible = _visible_workspace_ids(db, current_user)
    old_images = {item.image_url for item in tv.items if item.image_url}

    rows: list[TvItem] = []
    for position, entry in enumerate(data.items):
        row = TvItem(tv_id=tv.id, position=position, kind=entry.kind, seconds=entry.seconds)
        if entry.kind == "report_page":
            if not entry.report_id or not entry.page_name:
                raise HTTPException(status_code=422, detail="Escolha o relatorio e a pagina de cada item de relatorio")
            report = db.query(Report).get(entry.report_id)
            if report is None:
                raise HTTPException(status_code=404, detail="Relatorio nao encontrado")
            # Um relatorio que ja estava na TV continua valendo mesmo para quem nao o enxerga (outra pessoa o colocou);
            # um relatorio novo so entra se quem monta a lista o enxerga e ele nao tem seguranca por linha.
            if report.id not in already:
                if visible is not None and report.collection_id not in visible:
                    raise HTTPException(status_code=403, detail="Voce nao tem acesso ao relatorio escolhido")
                if _is_rls(db, report):
                    raise HTTPException(
                        status_code=400,
                        detail=f"O relatorio {report.name} tem seguranca por linha (RLS) e nao pode passar na TV.",
                    )
            row.report_id, row.page_name = report.id, entry.page_name
        elif entry.kind == "image":
            url = entry.image_url or ""
            if not url.startswith("/static/uploads/tv/") or ".." in url:
                raise HTTPException(status_code=422, detail="Envie a imagem pelo sistema antes de colocar na lista")
            row.image_url = url
        else:
            video_id = tv_core.youtube_video_id(entry.video_url or "")
            if video_id is None:
                raise HTTPException(status_code=422, detail="O link do YouTube nao e valido")
            row.video_id, row.sound = video_id, bool(entry.sound)
        rows.append(row)

    tv.items.clear()
    db.flush()
    for row in rows:
        tv.items.append(row)
    db.commit()
    db.refresh(tv)
    for url in old_images - {r.image_url for r in rows if r.image_url}:
        _remove_image_file(url)
    _audit(db, current_user, "update_tv_items", tv, f"{tv.name}: {len(rows)} itens")
    return _tv_out(db, tv, level)


@router.post("/{tv_id}/image")
def upload_image(tv_id: int, file: UploadFile, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Guarda a imagem e devolve o endereco para usar num item. Confere o conteudo do arquivo, nao so o tipo informado."""
    _require_level(db, current_user, tv_id, tv_access.MODIFY)
    contents = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Imagem maior que o limite de 10MB")
    extension = _sniff_image(contents[:16])
    if extension is None:
        raise HTTPException(status_code=400, detail="Formato de imagem nao suportado (use PNG, JPG, GIF ou WebP)")
    TV_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    (TV_UPLOAD_DIR / filename).write_bytes(contents)
    return {"image_url": f"/static/uploads/tv/{filename}"}


@router.get("/{tv_id}/code", response_model=CodeOut)
def get_code(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, _ = _require_level(db, current_user, tv_id, tv_access.VIEW)
    code, left = tv_core.current_code(tv)
    return CodeOut(code=code, expires_in_seconds=left)


@router.post("/{tv_id}/disconnect", status_code=204)
def disconnect_tv(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, _ = _require_level(db, current_user, tv_id, tv_access.VIEW)
    tv.sessions_revoked_at = datetime.now(timezone.utc)
    tv.last_seen_at = None
    db.commit()
    _audit(db, current_user, "tv_disconnect", tv)


@router.post("/{tv_id}/regenerate-link", response_model=TvOut)
def regenerate_link(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Troca o link secreto (o antigo para de funcionar) e desconecta a TV."""
    tv, level = _require_level(db, current_user, tv_id, tv_access.MODIFY)
    tv.link_secret = tv_core.new_secret()
    tv.sessions_revoked_at = datetime.now(timezone.utc)
    tv.last_seen_at = None
    db.commit()
    db.refresh(tv)
    _audit(db, current_user, "tv_regenerate_link", tv)
    return _tv_out(db, tv, level)


@router.get("/{tv_id}/grants", response_model=list[GrantOut])
def get_grants(tv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_level(db, current_user, tv_id, tv_access.MODIFY)
    result: list[GrantOut] = []
    for grant in db.query(TvGrant).filter(TvGrant.tv_id == tv_id).order_by(TvGrant.id).all():
        if grant.user_id is not None:
            user = db.query(User).get(grant.user_id)
            name = (user.name or user.email) if user else "(pessoa removida)"
        else:
            group = db.query(Group).get(grant.group_id)
            name = group.name if group else "(grupo removido)"
        result.append(GrantOut(user_id=grant.user_id, group_id=grant.group_id, name=name, level=grant.level))
    return result


@router.put("/{tv_id}/grants", response_model=list[GrantOut])
def replace_grants(tv_id: int, data: GrantsIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tv, _ = _require_level(db, current_user, tv_id, tv_access.MODIFY)
    seen: dict[tuple[str, int], str] = {}
    for grant in data.grants:
        if (grant.user_id is None) == (grant.group_id is None):
            raise HTTPException(status_code=422, detail="Cada permissao e de uma pessoa ou de um grupo")
        key = ("user", grant.user_id) if grant.user_id is not None else ("group", grant.group_id)
        # Se a mesma pessoa ou grupo aparecer duas vezes, vale a permissao maior
        if tv_access._RANK[grant.level] > tv_access._RANK.get(seen.get(key, ""), 0):
            seen[key] = grant.level
    user_ids = [i for (kind, i) in seen if kind == "user"]
    group_ids = [i for (kind, i) in seen if kind == "group"]
    if user_ids and db.query(User).filter(User.id.in_(user_ids)).count() != len(user_ids):
        raise HTTPException(status_code=404, detail="Pessoa nao encontrada")
    if group_ids and db.query(Group).filter(Group.id.in_(group_ids)).count() != len(group_ids):
        raise HTTPException(status_code=404, detail="Grupo nao encontrado")
    db.query(TvGrant).filter(TvGrant.tv_id == tv_id).delete()
    for (kind, subject_id), level in seen.items():
        db.add(TvGrant(tv_id=tv_id, user_id=subject_id if kind == "user" else None, group_id=subject_id if kind == "group" else None, level=level))
    db.commit()
    _audit(db, current_user, "update_tv_grants", tv, f"{tv.name}: {len(seen)} permissoes")
    return get_grants(tv_id, db, current_user)


# --- Rotas da TV (sem login) -----------------------------------------------------------------------------------------


def _device_tv(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> Tv:
    """A TV dona do token da conexao. Token invalido, vencido, de outro tipo ou de uma conexao ja desfeita: 401."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    payload = tv_core.read_device_token(token) if token else None
    tv = db.query(Tv).get(payload["tv"]) if payload else None
    if tv is None or tv_core.token_is_revoked(tv, payload):
        raise HTTPException(status_code=401, detail="Conexao da TV encerrada. Abra o link e digite o codigo de novo.")
    return tv


@player_router.post("/{link_secret}/connect", response_model=ConnectOut)
@limiter.limit("20/minute")
def connect(request: Request, link_secret: str, data: ConnectIn, db: Session = Depends(get_db)):
    tv = db.query(Tv).filter(Tv.link_secret == link_secret).first()
    # Link errado e codigo errado respondem igual: quem adivinha links nao descobre se a TV existe
    if tv is None:
        raise HTTPException(status_code=403, detail="Codigo incorreto")
    if tv_core.is_locked(tv.id):
        raise HTTPException(status_code=429, detail="Muitas tentativas erradas. Espere alguns minutos e tente de novo.")
    if not tv_core.code_is_valid(tv, data.code):
        tv_core.register_failure(tv.id)
        raise HTTPException(status_code=403, detail="Codigo incorreto")
    tv_core.clear_failures(tv.id)
    token, expires_at = tv_core.create_device_token(tv)
    tv.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    _audit(db, None, "tv_connect", tv)
    return ConnectOut(token=token, expires_at=expires_at, name=tv.name)


@player_router.get("/{link_secret}/name")
def link_name(link_secret: str, db: Session = Depends(get_db)):
    """So confirma que o link existe, sem dar o nome da TV (a tela de codigo nao precisa dele e o link e secreto)."""
    if db.query(Tv.id).filter(Tv.link_secret == link_secret).first() is None:
        raise HTTPException(status_code=404, detail="Link nao encontrado")
    return {"ok": True}


@player_router.get("/playlist", response_model=PlaylistOut)
def playlist(db: Session = Depends(get_db), tv: Tv = Depends(_device_tv)):
    tv.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    items: list[PlayerItem] = []
    for item in tv.items:
        report_name = None
        if item.kind == "report_page":
            report = db.query(Report).get(item.report_id) if item.report_id else None
            if report is None:
                continue  # o relatorio foi apagado: o item sai da exibicao
            report_name = report.name
        items.append(
            PlayerItem(
                id=item.id,
                kind=item.kind,
                seconds=item.seconds,
                report_name=report_name,
                page_name=item.page_name,
                image_url=item.image_url,
                video_id=item.video_id,
                sound=bool(item.sound),
            )
        )
    return PlaylistOut(name=tv.name, items=items)


@player_router.get("/items/{item_id}/embed", response_model=EmbedConfig)
def item_embed(item_id: int, db: Session = Depends(get_db), tv: Tv = Depends(_device_tv)):
    """O embed do relatorio de um item da lista desta TV. Relatorio com seguranca por linha nunca sai por aqui."""
    item = db.query(TvItem).filter(TvItem.id == item_id, TvItem.tv_id == tv.id).first()
    report = db.query(Report).get(item.report_id) if item and item.report_id else None
    if item is None or report is None:
        raise HTTPException(status_code=404, detail="Item nao encontrado")
    workspace_id = report.collection_id
    embed_router._prune_expired(embed_router._embed_cache)
    cached = embed_router._cached_embed_config(workspace_id, report.id, 0)
    if cached:
        return cached
    connection = embed_router._get_connection_or_error(db, report)
    config, needs_identity = embed_router._generate_embed_config(connection, workspace_id, report, None)
    if needs_identity:
        raise HTTPException(status_code=400, detail="Relatorios com seguranca por linha (RLS) nao podem passar na TV.")
    embed_router._store_embed_config(workspace_id, report.id, 0, config, needs_identity)
    return config
