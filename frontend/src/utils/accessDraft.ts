import type { AccessPermission, GrantBlock } from "../api/access";

/** Rascunho das permissões: chave "global" ou o id da coleção, com o conjunto de permissões marcadas. */
export type Draft = Record<string, Set<string>>;

export const GLOBAL_SCOPE = "global";

export function scopeKey(workspaceId: number | null): string {
  return workspaceId === null ? GLOBAL_SCOPE : String(workspaceId);
}

export function draftFromBlocks(blocks: GrantBlock[]): Draft {
  const draft: Draft = {};
  for (const block of blocks) {
    if (block.permissions.length > 0) draft[scopeKey(block.workspace_id)] = new Set(block.permissions);
  }
  return draft;
}

/** Só os escopos que têm alguma permissão marcada, global primeiro e depois as coleções por id. */
export function blocksFromDraft(draft: Draft): GrantBlock[] {
  return Object.keys(draft)
    .filter((scope) => draft[scope].size > 0)
    .sort((a, b) => (a === GLOBAL_SCOPE ? -1 : b === GLOBAL_SCOPE ? 1 : Number(a) - Number(b)))
    .map((scope) => ({
      workspace_id: scope === GLOBAL_SCOPE ? null : Number(scope),
      permissions: [...draft[scope]].sort(),
    }));
}

/** Compara dois rascunhos pelo conteúdo, ignorando escopos vazios. */
export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(blocksFromDraft(a)) === JSON.stringify(blocksFromDraft(b));
}

/** As permissões que a escolha exige, em cadeia (criar assinatura exige ver as assinaturas, que exige ver a coleção).
 * É a mesma regra do servidor, que vem no catálogo no campo `requires`. */
function withRequirements(keys: Iterable<string>, permissions: AccessPermission[]): Set<string> {
  const byKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const result = new Set(keys);
  const pending = [...result];
  while (pending.length > 0) {
    for (const required of byKey.get(pending.pop() as string)?.requires ?? []) {
      if (!result.has(required)) {
        result.add(required);
        pending.push(required);
      }
    }
  }
  return result;
}

/** As permissões marcadas que deixam de fazer sentido quando as chaves dadas saem: as que as exigem, em cadeia. */
function dependentsOf(keys: Iterable<string>, marked: Set<string>, permissions: AccessPermission[]): Set<string> {
  const removed = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of permissions) {
      if (marked.has(permission.key) && !removed.has(permission.key) && permission.requires.some((r) => removed.has(r))) {
        removed.add(permission.key);
        changed = true;
      }
    }
  }
  return removed;
}

/** Liga ou desliga uma permissão. Ligar traz junto o que ela exige; desligar leva junto o que dela depende. */
export function togglePermission(draft: Draft, scope: string, key: string, checked: boolean, permissions: AccessPermission[]): Draft {
  const next = new Set(draft[scope] ?? []);
  if (checked) {
    withRequirements([key], permissions).forEach((k) => next.add(k));
  } else {
    dependentsOf([key], next, permissions).forEach((k) => next.delete(k));
  }
  return { ...draft, [scope]: next };
}

/** Liga ou desliga todos os itens de um grupo de uma vez. Os itens `locked` (o que a pessoa já recebe por grupo) não
 * saem do rascunho nem entram nele: ficam como estão. */
export function setFeature(
  draft: Draft,
  scope: string,
  itemKeys: string[],
  checked: boolean,
  permissions: AccessPermission[],
  locked: ReadonlySet<string> = new Set(),
): Draft {
  const keys = itemKeys.filter((key) => !locked.has(key));
  const next = new Set(draft[scope] ?? []);
  if (checked) {
    withRequirements(keys, permissions).forEach((k) => next.add(k));
  } else {
    dependentsOf(keys, next, permissions).forEach((k) => next.delete(k));
  }
  return { ...draft, [scope]: next };
}

export function setScope(draft: Draft, scope: string, keys: string[]): Draft {
  return { ...draft, [scope]: new Set(keys) };
}

export function removeScope(draft: Draft, scope: string): Draft {
  const { [scope]: _removed, ...rest } = draft;
  return rest;
}
