import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { safeStorage } from "../utils/safeStorage";

interface UseUrlTabOptions {
  /** Chave do storage pra lembrar a ultima aba aberta. Sem ela, nada e lembrado. */
  storageKey?: string;
}

/**
 * Aba ativa guardada na URL (`?tab=`): recarregar a pagina mantem a aba e da pra compartilhar um
 * link direto. A aba e derivada da URL a cada render (nao ha estado separado que possa divergir).
 *
 * Ordem de prioridade: `?tab=` valido, depois a ultima aba lembrada (se `storageKey`), depois
 * `fallback`. Valores invalidos (aba removida em uma versao nova) sao ignorados.
 * Trocar de aba usa `replace`, entao o botao Voltar do navegador nao percorre cada aba visitada.
 */
export function useUrlTab<T extends string>(
  validTabs: readonly T[],
  fallback: T,
  options: UseUrlTabOptions = {},
): [T, (next: T) => void] {
  const { storageKey } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const isValid = (value: string | null): value is T => value !== null && (validTabs as readonly string[]).includes(value);

  const fromUrl = searchParams.get("tab");
  const remembered = storageKey ? safeStorage.getItem(storageKey) : null;
  const tab: T = isValid(fromUrl) ? fromUrl : isValid(remembered) ? remembered : fallback;

  const setTab = useCallback(
    (next: T) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set("tab", next);
          return params;
        },
        { replace: true },
      );
      if (storageKey) safeStorage.setItem(storageKey, next);
    },
    [setSearchParams, storageKey],
  );

  return [tab, setTab];
}
