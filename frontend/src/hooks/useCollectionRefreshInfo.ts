import { useEffect, useState } from "react";
import * as reportsApi from "../api/reports";
import type { RefreshInfo } from "../api/reports";

const SEM_INFO: Record<string, RefreshInfo> = {};

/** Ultima e proxima atualizacao de todos os relatorios da colecao, buscadas numa requisicao so.
 * Busca de novo quando a colecao muda ou quando a lista de relatorios muda (um relatorio novo
 * precisa aparecer com a info dele). Falha em silencio: a info e um detalhe, nao pode atrapalhar. */
export function useCollectionRefreshInfo(workspaceId: number | undefined, reportIds: number[]) {
  const [info, setInfo] = useState<Record<string, RefreshInfo>>(SEM_INFO);
  const idsKey = reportIds.join(",");

  useEffect(() => {
    if (workspaceId === undefined || idsKey === "") return;
    let cancelled = false;
    reportsApi
      .getCollectionRefreshInfo(workspaceId)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, idsKey]);

  // Os ids dos relatorios nao se repetem entre colecoes, entao o que sobrou da colecao anterior
  // nunca aparece na colecao nova.
  return idsKey === "" ? SEM_INFO : info;
}
