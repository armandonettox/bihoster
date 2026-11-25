/** Ajudantes da arvore de pastas (colecoes dentro de colecoes). Funcoes puras sobre `parent_id`. */

interface Node {
  id: number;
  parent_id?: number | null;
}

/** As pastas de topo para esta pessoa: as que nao tem pai ou cujo pai ela nao acessa (ela nao ve o pai, entao a pasta
 * dela aparece no nivel de cima). */
export function topLevel<T extends Node>(items: T[]): T[] {
  const ids = new Set(items.map((item) => item.id));
  return items.filter((item) => item.parent_id == null || !ids.has(item.parent_id));
}

export function childrenOf<T extends Node>(items: T[], id: number): T[] {
  return items.filter((item) => item.parent_id === id);
}

/** A pasta e tudo o que ha dentro dela, em qualquer nivel. */
export function descendantIds(items: Node[], id: number): Set<number> {
  const result = new Set<number>();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop() as number;
    for (const item of items) {
      if (item.parent_id === current && !result.has(item.id) && item.id !== id) {
        result.add(item.id);
        pending.push(item.id);
      }
    }
  }
  return result;
}

/** Do topo ate a pasta (inclusive). Para se achar um ciclo, em vez de girar para sempre. */
export function pathTo<T extends Node>(items: T[], id: number): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: T[] = [];
  const seen = new Set<number>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return path;
}
