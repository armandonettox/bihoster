"""Arvore de pastas: as colecoes podem ficar dentro de outras (workspaces.parent_id).

Tudo aqui e funcao pura sobre o mapa {id: parent_id}, lido uma vez por requisicao (`load_parent_map`). A profundidade
maxima e uma constante do codigo, de proposito: so vira configuracao se houver necessidade real. A pasta de topo tem
profundidade 1."""

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models.workspace import Workspace

MAX_DEPTH = 5

ParentMap = dict[int, int | None]


def load_parent_map(db: Session) -> ParentMap:
    """Todas as colecoes (id -> pasta pai). Uma consulta so; as colecoes sao poucas."""
    return {row.id: row.parent_id for row in db.query(Workspace.id, Workspace.parent_id).all()}


def children_map(parents: ParentMap) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for child, parent in parents.items():
        if parent is not None:
            result.setdefault(parent, []).append(child)
    return result


def ancestors(parents: ParentMap, workspace_id: int) -> list[int]:
    """As pastas acima, da mais proxima para a de topo. Para se achar um ciclo (dado sujo), em vez de girar para sempre."""
    result: list[int] = []
    seen = {workspace_id}
    current = parents.get(workspace_id)
    while current is not None and current not in seen:
        result.append(current)
        seen.add(current)
        current = parents.get(current)
    return result


def descendants(parents: ParentMap, workspace_id: int) -> set[int]:
    kids = children_map(parents)
    result: set[int] = set()
    pending = list(kids.get(workspace_id, []))
    while pending:
        node = pending.pop()
        if node in result or node == workspace_id:
            continue
        result.add(node)
        pending.extend(kids.get(node, []))
    return result


def depth_of(parents: ParentMap, workspace_id: int) -> int:
    """1 para uma pasta de topo."""
    return 1 + len(ancestors(parents, workspace_id))


def height_of(parents: ParentMap, workspace_id: int) -> int:
    """Quantos niveis a pasta tem para baixo, contando ela mesma (1 = sem subpastas)."""
    kids = children_map(parents)

    def height(node: int, seen: frozenset[int]) -> int:
        below = [height(child, seen | {node}) for child in kids.get(node, []) if child not in seen]
        return 1 + (max(below) if below else 0)

    return height(workspace_id, frozenset())


def validate_parent(parents: ParentMap, workspace_id: int | None, new_parent_id: int | None) -> str | None:
    """Devolve o motivo de recusar, ou None se pode. `workspace_id` None = pasta ainda nao criada.

    Recusa: pai que nao existe, a pasta dentro dela mesma ou de uma descendente (ciclo) e passar de MAX_DEPTH niveis
    (contando o que a pasta ja tem para baixo)."""
    if new_parent_id is None:
        return None
    if new_parent_id not in parents:
        return "A pasta escolhida nao existe"
    if workspace_id is not None:
        if new_parent_id == workspace_id or new_parent_id in descendants(parents, workspace_id):
            return "Uma pasta nao pode ficar dentro dela mesma nem de uma pasta que ela contem"
    own_height = height_of(parents, workspace_id) if workspace_id is not None else 1
    if depth_of(parents, new_parent_id) + own_height > MAX_DEPTH:
        return f"As pastas podem ter no maximo {MAX_DEPTH} niveis"
    return None


def inherit_keys(by_workspace: dict[int, set[str]], parents: ParentMap) -> dict[int, set[str]]:
    """Cada pasta passa as permissoes que tem para as pastas dentro dela. So soma: quem ve "Financeiro" ve
    "Financeiro > Faturamento", e a subpasta pode ter permissao extra. Nao existe jeito de esconder uma subpasta de quem
    ve a pasta pai: o restrito fica numa pasta de topo propria."""
    if not by_workspace or not any(parent is not None for parent in parents.values()):
        return by_workspace
    result = {wid: set(keys) for wid, keys in by_workspace.items()}
    kids = children_map(parents)
    for wid, keys in by_workspace.items():
        pending = list(kids.get(wid, []))
        seen = {wid}
        while pending:
            node = pending.pop()
            if node in seen:
                continue
            seen.add(node)
            result.setdefault(node, set()).update(keys)
            pending.extend(kids.get(node, []))
    return result


def visible_with_path(accessible: Iterable[int], parents: ParentMap) -> dict[int, bool]:
    """Pastas que a pessoa enxerga na arvore: as que ela acessa (True) e as de cima delas (False), so como caminho de
    navegacao, sem o conteudo."""
    result: dict[int, bool] = {}
    for wid in accessible:
        if wid in parents:
            result[wid] = True
    for wid in list(result):
        for ancestor in ancestors(parents, wid):
            result.setdefault(ancestor, False)
    return result
