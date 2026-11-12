import { useEffect, useState } from "react";
import { getAnalyticsAccess } from "../api/analyticsAccess";

interface UseAnalyticsAccessResult {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  loading: boolean;
}

const NONE = { canView: false, canCreate: false, canEdit: false, canDelete: false };

/** Permissoes de analiticos da pessoa logada. Se a consulta falhar, assume sem acesso: o servidor
 * barra a rota de qualquer jeito, a tela so nao mostra o que a pessoa nao pode usar. */
export function useAnalyticsAccess(): UseAnalyticsAccessResult {
  const [access, setAccess] = useState(NONE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAnalyticsAccess()
      .then((data) => {
        if (!cancelled) {
          setAccess({ canView: data.can_view, canCreate: data.can_create, canEdit: data.can_edit, canDelete: data.can_delete });
        }
      })
      .catch(() => {
        if (!cancelled) setAccess(NONE);
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
