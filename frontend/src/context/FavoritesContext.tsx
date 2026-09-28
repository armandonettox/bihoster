import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as favoritesApi from "../api/favorites";
import type { Report } from "../api/reports";
import { useToast } from "./ToastContext";
import { extractErrorMessage } from "../api/client";

interface FavoritesContextValue {
  favorites: Report[];
  favoriteIds: Set<number>;
  toggleFavorite: (reportId: number) => Promise<void>;
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

  async function toggleFavorite(reportId: number) {
    if (pendingRef.current.has(reportId)) return;
    pendingRef.current.add(reportId);
    try {
      if (favoriteIds.has(reportId)) {
        await favoritesApi.removeFavorite(reportId);
      } else {
        await favoritesApi.addFavorite(reportId);
      }
      await reload();
    } catch (err: any) {
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
