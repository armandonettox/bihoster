import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as favoritesApi from "../api/favorites";
import type { Report } from "../api/reports";
import { useToast } from "./ToastContext";
import { extractErrorMessage } from "../api/client";

interface FavoritesContextValue {
  favorites: Report[];
  favoriteIds: Set<number>;
  toggleFavorite: (reportId: number, report?: Report) => Promise<void>;
  reload: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Report[]>([]);
  const { showToast } = useToast();
  // Evita que um duplo clique rapido na estrela (antes do primeiro toggle terminar e
  // recarregar a lista) dispare duas chamadas -- a segunda falhava no backend ("ja
  // favoritado") e mostrava um erro falso mesmo a acao desejada ja tendo sido concluida.
  const pendingRef = useRef<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setFavorites(await favoritesApi.listFavorites());
  }, []);

  useEffect(() => {
    reload().catch(() => showToast("Nao foi possivel carregar seus favoritos.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  /**
   * Alterna o favorito. A estrela muda na hora (atualizacao otimista) e volta ao estado anterior
   * se a API falhar, em vez de esperar a resposta e recarregar a lista inteira.
   * Passe `report` ao ADICIONAR: a lista guarda relatorios completos, entao sem ele nao ha o que
   * mostrar de imediato e o caminho e o antigo (espera a API e recarrega).
   */
  async function toggleFavorite(reportId: number, report?: Report) {
    if (pendingRef.current.has(reportId)) return;
    pendingRef.current.add(reportId);

    const isFavorite = favoriteIds.has(reportId);
    // Item que sai da lista (e onde estava), guardado pra devolver so ele se a API falhar
    const removedIndex = favorites.findIndex((f) => f.id === reportId);
    const removed = isFavorite && removedIndex >= 0 ? favorites[removedIndex] : undefined;
    // So ha atualizacao otimista quando sabemos o que mostrar: remover (ja temos o item) ou
    // adicionar com o relatorio em maos.
    const optimistic = isFavorite ? removed !== undefined : report !== undefined;
    if (optimistic) {
      setFavorites((current) =>
        isFavorite ? current.filter((f) => f.id !== reportId) : [...current, report as Report],
      );
    }

    try {
      if (isFavorite) {
        await favoritesApi.removeFavorite(reportId);
      } else {
        await favoritesApi.addFavorite(reportId);
      }
      pendingRef.current.delete(reportId);
      // Com atualizacao otimista a lista ja esta certa; recarrega em segundo plano so pra
      // convergir com o servidor (ex: ordem), sem travar a interface nem avisar se falhar.
      // So recarrega quando NENHUMA outra alteracao esta em voo: o servidor ainda nao conhece as
      // pendentes, e a lista dele apagaria da tela o que o usuario acabou de marcar.
      // Sem atualizacao otimista (adicionar sem o relatorio) a recarga e o que mostra o resultado.
      if (optimistic) {
        if (pendingRef.current.size === 0) reload().catch(() => {});
      } else {
        await reload();
      }
    } catch (err: any) {
      if (optimistic) {
        // Desfaz so ESTE favorito, de forma funcional: restaurar uma foto antiga da lista inteira
        // apagaria tambem outro favorito alterado com sucesso enquanto este estava pendente.
        setFavorites((current) => {
          if (!isFavorite) return current.filter((f) => f.id !== reportId);
          if (current.some((f) => f.id === reportId)) return current;
          // Volta pra posicao de antes (a ordem dos favoritos aparece na barra lateral)
          const next = [...current];
          next.splice(Math.min(removedIndex, next.length), 0, removed as Report);
          return next;
        });
      }
      showToast(extractErrorMessage(err) || "Nao foi possivel atualizar os favoritos.", "error");
    } finally {
      pendingRef.current.delete(reportId);
    }
  }

  return (
    <FavoritesContext.Provider value={{ favorites, favoriteIds, toggleFavorite, reload }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites precisa ser usado dentro de um FavoritesProvider");
  }
  return context;
}
