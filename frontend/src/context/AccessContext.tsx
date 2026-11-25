import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMyAccess, type MyAccess } from "../api/access";
import { useAuth } from "./AuthContext";

export interface AccessValue {
  /** Enquanto as permissões da pessoa ainda estão sendo buscadas */
  loading: boolean;
  /** Administrador da plataforma: tem todas as permissões */
  isAdmin: boolean;
  /** Tem esta permissão do sistema todo? */
  can: (key: string) => boolean;
  /** Tem esta permissão nesta coleção? */
  canIn: (key: string, workspaceId: number | null | undefined) => boolean;
  /** Tem esta permissão em alguma coleção? */
  canInAny: (key: string) => boolean;
  /** Tem esta permissão neste relatório? Vale o que foi dado direto nele ou o que vem da coleção dele */
  canInReport: (key: string, reportId: number | null | undefined, workspaceId: number | null | undefined) => boolean;
  /** Tem alguma destas permissões do sistema todo? */
  canAny: (...keys: string[]) => boolean;
  /** Tem esta permissão neste escopo do rascunho de permissões ("global" ou o id da coleção)? Só se dá e se tira o que se tem */
  holds: (scope: string, key: string) => boolean;
  /** Cria TVs ou tem acesso a alguma TV: mostra o módulo Modo TV */
  hasTvAccess: boolean;
  /** Recebeu algum relatório ou modelo direto (por ela ou por um grupo): o módulo Relatórios aparece mesmo sem o catálogo geral */
  hasItemGrants: boolean;
  /** Busca de novo (depois de a pessoa mudar as próprias permissões) */
  refresh: () => Promise<void>;
}

/** Monta o que a tela consulta a partir da resposta de /access/me. O administrador da plataforma tem tudo, sem
 * depender da lista. Função pura, de propósito: os testes das telas usam ela para montar o acesso que querem. */
export function buildAccess(
  me: MyAccess | null,
  loading = false,
  refresh: () => Promise<void> = async () => {},
): AccessValue {
  const isAdmin = me?.is_admin ?? false;
  const globalKeys = new Set(me?.global_permissions ?? []);
  const byWorkspace = new Map<number, Set<string>>(
    Object.entries(me?.workspace_permissions ?? {}).map(([id, keys]) => [Number(id), new Set(keys)]),
  );
  const byReport = new Map<number, Set<string>>(
    Object.entries(me?.report_permissions ?? {}).map(([id, keys]) => [Number(id), new Set(keys)]),
  );
  const hasItemGrants =
    Object.values(me?.report_permissions ?? {}).some((keys) => keys.includes("relatorio.ver")) ||
    Object.values(me?.dataset_permissions ?? {}).some((keys) => keys.includes("modelo.ver"));
  const can = (key: string) => isAdmin || globalKeys.has(key);
  return {
    loading,
    isAdmin,
    can,
    canIn: (key, workspaceId) => isAdmin || (workspaceId != null && (byWorkspace.get(workspaceId)?.has(key) ?? false)),
    canInAny: (key) => isAdmin || [...byWorkspace.values()].some((keys) => keys.has(key)),
    canInReport: (key, reportId, workspaceId) =>
      isAdmin ||
      (workspaceId != null && (byWorkspace.get(workspaceId)?.has(key) ?? false)) ||
      (reportId != null && (byReport.get(reportId)?.has(key) ?? false)),
    canAny: (...keys) => keys.some(can),
    hasTvAccess: isAdmin || can("tv.criar") || (me?.tv_access ?? false),
    hasItemGrants,
    holds: (scope, key) => (scope === "global" ? can(key) : isAdmin || (byWorkspace.get(Number(scope))?.has(key) ?? false)),
    refresh,
  };
}

/** Atalho para os testes: o acesso de um administrador da plataforma */
export const ADMIN_ACCESS: MyAccess = { is_admin: true, global_permissions: [], workspace_permissions: {} };

export const AccessContext = createContext<AccessValue | undefined>(undefined);

/** Busca as permissões da pessoa logada uma vez e as entrega a quem perguntar. Sem sessão, ninguém tem nada. Se a busca
 * falhar, assume sem permissão nenhuma: o servidor barra cada rota de qualquer jeito, a tela só não mostra o que a
 * pessoa não pode usar. */
export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [me, setMe] = useState<MyAccess | null>(null);
  const [loading, setLoading] = useState(userId !== null);

  const load = useCallback(async () => {
    if (userId === null) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await getMyAccess());
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(userId !== null);
    void load();
  }, [userId, load]);

  const value = useMemo(() => buildAccess(me, loading, load), [me, loading, load]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessValue {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error("useAccess precisa ser usado dentro de um AccessProvider");
  }
  return context;
}
