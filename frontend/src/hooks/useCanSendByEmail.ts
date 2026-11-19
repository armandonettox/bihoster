import { useEffect, useState } from "react";
import * as emailApi from "../api/emailSettings";
import { useAccess } from "../context/AccessContext";

/** O envio de relatorio por e-mail esta disponivel pra esta pessoa nesta colecao? So com a permissao de exportar por
 * e-mail (que nenhum atalho liga: so o administrador da plataforma e quem recebeu esse item de proposito) e so quando o
 * servidor de e-mail ja foi configurado. Quem nao tem a permissao nem chega a consultar o servidor. Em caso de falha na
 * consulta, o envio simplesmente nao aparece. */
export function useCanSendByEmail(workspaceId: number | null | undefined): boolean {
  const allowed = useAccess().canIn("relatorio.exportar", workspaceId);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    emailApi
      .getEmailStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return allowed && configured;
}
