import { useEffect, useState } from "react";
import * as emailApi from "../api/emailSettings";
import { useAuth } from "../context/AuthContext";

/** O envio de relatorio por e-mail esta disponivel pra esta pessoa? So administradores da plataforma
 * (por enquanto) e so quando o servidor de e-mail ja foi configurado. Quem nao e administrador nem
 * chega a consultar o servidor. Em caso de falha na consulta, o envio simplesmente nao aparece. */
export function useCanSendByEmail(): boolean {
  const { user } = useAuth();
  const isAdmin = user?.is_platform_admin ?? false;
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);

  return isAdmin && configured;
}
