"""O catalogo do tenant visto como o Power BI Service: workspaces e, dentro de cada um, relatorios e modelos semanticos.

Tres coisas moram aqui:
- A UNIAO dos modelos: o que a sincronizacao trouxe (pbi_datasets) somado aos modelos dos relatorios ja cadastrados
  (reports.pbi_dataset_id). Antes a lista so olhava a sincronizacao, e ficava vazia ate alguem sincronizar, mesmo com
  relatorios apontando para modelos. O nome vem da API quando a sincronizacao roda e, ate la, e o id curto.
- Quem enxerga o que: quem tem o catalogo geral ve tudo daquele tipo; as demais pessoas veem so o que receberam direto.
- A lista de workspaces e a de itens de um workspace, paginadas e filtradas no servidor."""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.access_engine import EffectiveAccess, effective_access
from app.models.catalog_sync import DatasetRoleGrant, PbiDataset
from app.models.dataset_grant import DatasetGrant
from app.models.powerbi_connection import PowerBIConnection
from app.models.report import Report
from app.models.report_grant import ReportCollection, ReportGrant
from app.models.user import User
from app.models.workspace import Group, Workspace

MAX_PAGE_SIZE = 100


def short_id(value: str) -> str:
    return (value or "")[:8]


def ensure_datasets_for_reports(db: Session, connection_id: int | None = None) -> int:
    """Cria a linha do modelo (pbi_datasets) para cada modelo que algum relatorio ja usa e ainda nao tem uma. O nome fica
    como o id curto ate a sincronizacao trazer o da API. Idempotente; quem chama faz o commit. Devolve quantos criou."""
    query = (
        db.query(Report.powerbi_connection_id, Report.pbi_workspace_id, Report.pbi_dataset_id, func.max(Report.pbi_workspace_name))
        .filter(Report.powerbi_connection_id.isnot(None), Report.pbi_dataset_id.isnot(None), Report.pbi_dataset_id != "")
        .group_by(Report.powerbi_connection_id, Report.pbi_workspace_id, Report.pbi_dataset_id)
    )
    if connection_id is not None:
        query = query.filter(Report.powerbi_connection_id == connection_id)
    known = {(row[0], row[1], row[2]) for row in db.query(PbiDataset.connection_id, PbiDataset.pbi_workspace_id, PbiDataset.pbi_dataset_id)}
    created = 0
    for conn_id, workspace_id, dataset_id, workspace_name in query.all():
        if (conn_id, workspace_id, dataset_id) in known:
            continue
        db.add(
            PbiDataset(
                connection_id=conn_id,
                pbi_workspace_id=workspace_id,
                pbi_workspace_name=workspace_name,
                pbi_dataset_id=dataset_id,
                name=f"Modelo {short_id(dataset_id)}",
            )
        )
        created += 1
    if created:
        db.flush()
    return created


@dataclass
class Scope:
    """O que a pessoa enxerga no catalogo."""

    all_reports: bool
    all_datasets: bool
    report_ids: set[int] = field(default_factory=set)
    dataset_ids: set[int] = field(default_factory=set)
    access: EffectiveAccess | None = None

    @property
    def any(self) -> bool:
        return self.all_reports or self.all_datasets or bool(self.report_ids) or bool(self.dataset_ids)


def scope_of_user(db: Session, user_id: int) -> Scope:
    """Quem tem `relatorio.catalogo` (ou `modelo.catalogo`) ve todos os relatorios (ou modelos); as demais pessoas veem
    so os relatorios e modelos em que receberam "ver" direto, por elas ou por um grupo."""
    access = effective_access(db, user_id)
    return Scope(
        all_reports=access.has_global("relatorio.catalogo"),
        all_datasets=access.has_global("modelo.catalogo"),
        report_ids=access.reports_with("relatorio.ver"),
        dataset_ids=access.datasets_with("modelo.ver"),
        access=access,
    )


def _workspace_label(name: str | None, workspace_id: str) -> str:
    return name or f"Workspace {short_id(workspace_id)}"


def list_workspaces(db: Session, scope: Scope, search: str = "") -> list[dict]:
    """Os workspaces do tenant que a pessoa enxerga, com quantos relatorios e modelos tem cada um, a ultima sincronizacao e
    quantos relatorios novos ainda estao sem acesso."""
    reports = db.query(Report.id, Report.powerbi_connection_id, Report.pbi_workspace_id, Report.pbi_workspace_name, Report.synced_at, Report.collection_id)
    if not scope.all_reports:
        reports = reports.filter(Report.id.in_(scope.report_ids or [-1]))
    datasets = db.query(PbiDataset.id, PbiDataset.connection_id, PbiDataset.pbi_workspace_id, PbiDataset.pbi_workspace_name, PbiDataset.synced_at)
    if not scope.all_datasets:
        datasets = datasets.filter(PbiDataset.id.in_(scope.dataset_ids or [-1]))

    root_ids = {row[0] for row in db.query(Workspace.id).filter(Workspace.system_key.isnot(None))}
    granted = {row[0] for row in db.query(ReportGrant.report_id).distinct()}
    linked = {row[0] for row in db.query(ReportCollection.report_id).distinct()}
    rows: dict[tuple, dict] = {}

    def row_for(connection_id: int | None, workspace_id: str, name: str | None) -> dict:
        key = (connection_id, workspace_id)
        row = rows.setdefault(
            key,
            {"connection_id": connection_id, "pbi_workspace_id": workspace_id, "name": None, "reports": 0, "datasets": 0, "last_synced_at": None, "pending": 0},
        )
        if name and not row["name"]:
            row["name"] = name
        return row

    def touch(row: dict, synced_at: datetime | None) -> None:
        if synced_at is not None and (row["last_synced_at"] is None or synced_at > row["last_synced_at"]):
            row["last_synced_at"] = synced_at

    for report_id, connection_id, workspace_id, name, synced_at, collection_id in reports.all():
        row = row_for(connection_id, workspace_id, name)
        row["reports"] += 1
        touch(row, synced_at)
        if collection_id in root_ids and report_id not in granted and report_id not in linked:
            row["pending"] += 1
    for _, connection_id, workspace_id, name, synced_at in datasets.all():
        row = row_for(connection_id, workspace_id, name)
        row["datasets"] += 1
        touch(row, synced_at)

    connections = {c.id: c.name for c in db.query(PowerBIConnection.id, PowerBIConnection.name)}
    needle = search.strip().lower()
    result = []
    for row in rows.values():
        row["name"] = _workspace_label(row["name"], row["pbi_workspace_id"])
        row["connection_name"] = connections.get(row["connection_id"])
        if needle and needle not in row["name"].lower() and needle not in (row["connection_name"] or "").lower():
            continue
        result.append(row)
    return sorted(result, key=lambda r: r["name"].lower())


def _people_of(db: Session, subjects: dict[int, list[tuple[int | None, int | None]]]) -> dict[int, dict]:
    """Resumo de quem tem acesso direto a cada item: quantos sao e ate 3 rostos. `subjects`: id do item para a lista
    de (user_id, group_id)."""
    user_ids = {u for pairs in subjects.values() for u, _ in pairs if u}
    group_ids = {g for pairs in subjects.values() for _, g in pairs if g}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids or [-1]))}
    groups = {g.id: g for g in db.query(Group).filter(Group.id.in_(group_ids or [-1]))}
    result = {}
    for item_id, pairs in subjects.items():
        unique = list(dict.fromkeys(pairs))
        faces = []
        for user_id, group_id in unique:
            if user_id and user_id in users:
                faces.append({"kind": "user", "name": users[user_id].name, "picture_url": users[user_id].picture_url})
            elif group_id and group_id in groups:
                faces.append({"kind": "group", "name": groups[group_id].name, "picture_url": None})
        result[item_id] = {"count": len(unique), "people": faces[:3]}
    return result


def list_items(
    db: Session,
    scope: Scope,
    *,
    connection_id: int | None,
    workspace_id: str | None,
    kind: str = "all",
    search: str = "",
    sort: str = "name",
    descending: bool = False,
    pending_only: bool = False,
    page: int = 1,
    page_size: int = 25,
) -> dict:
    """Relatorios e modelos de um workspace (ou de todos), numa lista so, paginada no servidor."""
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    page = max(1, page)
    needle = search.strip().lower()
    access = scope.access
    root_ids = {row[0] for row in db.query(Workspace.id).filter(Workspace.system_key.isnot(None))}
    items: list[dict] = []

    if kind in ("all", "report"):
        query = db.query(Report)
        if not scope.all_reports:
            query = query.filter(Report.id.in_(scope.report_ids or [-1]))
        if connection_id is not None:
            query = query.filter(Report.powerbi_connection_id == connection_id)
        if workspace_id:
            query = query.filter(Report.pbi_workspace_id == workspace_id)
        for report in query.all():
            if needle and needle not in report.name.lower():
                continue
            items.append({"kind": "report", "id": report.id, "name": report.name, "obj": report})

    if kind in ("all", "dataset"):
        ensure_datasets_for_reports(db)
        db.commit()
        query = db.query(PbiDataset)
        if not scope.all_datasets:
            query = query.filter(PbiDataset.id.in_(scope.dataset_ids or [-1]))
        if connection_id is not None:
            query = query.filter(PbiDataset.connection_id == connection_id)
        if workspace_id:
            query = query.filter(PbiDataset.pbi_workspace_id == workspace_id)
        for dataset in query.all():
            if needle and needle not in dataset.name.lower():
                continue
            items.append({"kind": "dataset", "id": dataset.id, "name": dataset.name, "obj": dataset})

    report_ids = [i["id"] for i in items if i["kind"] == "report"]
    dataset_ids = [i["id"] for i in items if i["kind"] == "dataset"]
    report_subjects: dict[int, list] = {}
    for report_id, user_id, group_id in db.query(ReportGrant.report_id, ReportGrant.user_id, ReportGrant.group_id).filter(ReportGrant.report_id.in_(report_ids or [-1])):
        report_subjects.setdefault(report_id, []).append((user_id, group_id))
    dataset_subjects: dict[int, list] = {}
    for dataset_id, user_id, group_id in db.query(DatasetGrant.dataset_id, DatasetGrant.user_id, DatasetGrant.group_id).filter(DatasetGrant.dataset_id.in_(dataset_ids or [-1])):
        dataset_subjects.setdefault(dataset_id, []).append((user_id, group_id))
    linked_report_ids = {row[0] for row in db.query(ReportCollection.report_id).filter(ReportCollection.report_id.in_(report_ids or [-1]))}

    for item in items:
        subjects = (report_subjects if item["kind"] == "report" else dataset_subjects).get(item["id"], [])
        item["access_count"] = len(set(subjects))
        item["pending"] = item["kind"] == "report" and item["obj"].collection_id in root_ids and not subjects and item["id"] not in linked_report_ids

    pending_total = sum(1 for i in items if i["pending"])
    if pending_only:
        items = [i for i in items if i["pending"]]

    keys = {
        "name": lambda i: (i["name"].lower(), i["kind"], i["id"]),
        "kind": lambda i: (i["kind"], i["name"].lower(), i["id"]),
        "updated": lambda i: (i["obj"].synced_at is None, i["obj"].synced_at.timestamp() if i["obj"].synced_at else 0, i["name"].lower()),
        "access": lambda i: (i["access_count"], i["name"].lower()),
    }
    items.sort(key=keys.get(sort, keys["name"]), reverse=descending)
    total = len(items)
    page_items = items[(page - 1) * page_size : page * page_size]

    # Enriquece so a pagina: pastas, rostos, RLS e o que a pessoa pode fazer em cada item
    people = _people_of(db, {i["id"] + (0 if i["kind"] == "report" else 10**9): (report_subjects if i["kind"] == "report" else dataset_subjects).get(i["id"], []) for i in page_items})
    folder_names = {w.id: w.name for w in db.query(Workspace.id, Workspace.name).filter(Workspace.system_key.is_(None))}
    links: dict[int, list[int]] = {}
    for report_id, folder_id in db.query(ReportCollection.report_id, ReportCollection.collection_id).filter(ReportCollection.report_id.in_([i["id"] for i in page_items if i["kind"] == "report"] or [-1])):
        links.setdefault(report_id, []).append(folder_id)
    datasets_by_key = {
        (d.connection_id, d.pbi_workspace_id, d.pbi_dataset_id): d
        for d in db.query(PbiDataset).filter(PbiDataset.pbi_dataset_id.in_({i["obj"].pbi_dataset_id for i in page_items if i["kind"] == "report" and i["obj"].pbi_dataset_id} or ["-"]))
    }
    role_counts = {
        did: n
        for did, n in db.query(DatasetRoleGrant.dataset_id, func.count(DatasetRoleGrant.id))
        .filter(DatasetRoleGrant.dataset_id.in_([d.id for d in datasets_by_key.values()] + [i["id"] for i in page_items if i["kind"] == "dataset"] or [-1]))
        .group_by(DatasetRoleGrant.dataset_id)
        .all()
    }
    reports_of_dataset: dict[tuple, int] = {}
    for conn_id, ws_id, ds_id, n in db.query(Report.powerbi_connection_id, Report.pbi_workspace_id, Report.pbi_dataset_id, func.count(Report.id)).filter(Report.pbi_dataset_id.isnot(None)).group_by(Report.powerbi_connection_id, Report.pbi_workspace_id, Report.pbi_dataset_id):
        reports_of_dataset[(conn_id, ws_id, ds_id)] = n

    from app.routers import powerbi as embed_router  # import aqui: o roteador importa este modulo

    def refresh_of(connection_id, dataset_pbi_id) -> dict:
        """Ultima e proxima atualizacao do modelo, SO se ja estiverem no cache que o aquecimento mantem."""
        cached = embed_router._refresh_info_cache.get((connection_id, dataset_pbi_id)) if dataset_pbi_id else None
        info = cached[1] if cached else {}
        return {"last_refresh_at": info.get("last_refresh"), "next_refresh_at": info.get("next_refresh"), "last_refresh_status": info.get("last_status")}

    rows = []
    for item in page_items:
        obj = item["obj"]
        if item["kind"] == "report":
            dataset = datasets_by_key.get((obj.powerbi_connection_id, obj.pbi_workspace_id, obj.pbi_dataset_id))
            folders = [] if obj.collection_id in root_ids else [folder_names.get(obj.collection_id, "")]
            folders += [folder_names.get(f, "") for f in links.get(obj.id, [])]
            keys_here = access.report_keys(obj.id, obj.collection_id, links.get(obj.id, [])) if access else set()
            global_manage = access.has_global("permissoes.editar") if access else False
            admin = bool(access and access.is_admin)
            rows.append(
                {
                    "kind": "report",
                    "id": obj.id,
                    "name": obj.name,
                    "connection_id": obj.powerbi_connection_id,
                    "pbi_workspace_id": obj.pbi_workspace_id,
                    "pbi_workspace_name": _workspace_label(obj.pbi_workspace_name, obj.pbi_workspace_id),
                    "collection_id": obj.collection_id,
                    "folders": [f for f in folders if f],
                    "in_root": obj.collection_id in root_ids,
                    "updated_at": obj.synced_at,
                    **refresh_of(obj.powerbi_connection_id, obj.pbi_dataset_id),
                    "missing": obj.sync_missing_at is not None,
                    "dataset_id": dataset.id if dataset else None,
                    "dataset_name": dataset.name if dataset else None,
                    "rls": {"requires_identity": dataset.is_effective_identity_required if dataset else None, "role_grants": role_counts.get(dataset.id, 0) if dataset else 0},
                    "access": people.get(item["id"], {"count": 0, "people": []}),
                    "pending": item["pending"],
                    "can": {
                        "open": admin or "relatorio.ver" in keys_here,
                        "share": admin or global_manage or "relatorio.compartilhar" in keys_here,
                        "security": False,
                        "refresh": False,
                        "history": False,
                        "folders": admin or "relatorio.editar" in keys_here,
                    },
                }
            )
        else:
            keys_here = access.dataset_keys(obj.id) if access else set()
            global_manage = access.has_global("permissoes.editar") if access else False
            admin = bool(access and access.is_admin)
            rows.append(
                {
                    "kind": "dataset",
                    "id": obj.id,
                    "name": obj.name,
                    "connection_id": obj.connection_id,
                    "pbi_workspace_id": obj.pbi_workspace_id,
                    "pbi_workspace_name": _workspace_label(obj.pbi_workspace_name, obj.pbi_workspace_id),
                    "collection_id": None,
                    "folders": [],
                    "in_root": False,
                    "updated_at": obj.synced_at,
                    **refresh_of(obj.connection_id, obj.pbi_dataset_id),
                    "missing": obj.sync_missing_at is not None,
                    "dataset_id": obj.id,
                    "dataset_name": obj.name,
                    "reports_count": reports_of_dataset.get((obj.connection_id, obj.pbi_workspace_id, obj.pbi_dataset_id), 0),
                    "rls": {"requires_identity": obj.is_effective_identity_required, "role_grants": role_counts.get(obj.id, 0)},
                    "access": people.get(item["id"] + 10**9, {"count": 0, "people": []}),
                    "pending": False,
                    "can": {
                        "open": False,
                        "share": admin or global_manage or "modelo.compartilhar" in keys_here,
                        "security": admin or "modelo.seguranca" in keys_here,
                        "refresh": admin or "modelo.atualizar" in keys_here,
                        "history": admin or "modelo.historico" in keys_here,
                        "folders": False,
                    },
                }
            )
    return {"items": rows, "total": total, "page": page, "page_size": page_size, "pending_total": pending_total}
