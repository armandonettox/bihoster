import { useEffect, useState } from "react";
import { getAIAccess } from "../api/aiSettings";

interface UseAiAccessResult {
  canManage: boolean;
  canUse: boolean;
  loading: boolean;
}

/** Permissoes de IA da pessoa logada. Se a consulta falhar, assume sem acesso: o servidor
 * barra a rota de qualquer jeito, a tela so nao mostra o que a pessoa nao pode usar. */
export function useAiAccess(): UseAiAccessResult {
  const [access, setAccess] = useState({ canManage: false, canUse: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAIAccess()
      .then((data) => {
        if (!cancelled) setAccess({ canManage: data.can_manage, canUse: data.can_use });
      })
      .catch(() => {
        if (!cancelled) setAccess({ canManage: false, canUse: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...access, loading };
}
