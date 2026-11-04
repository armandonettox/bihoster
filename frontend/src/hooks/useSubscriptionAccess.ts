import { useEffect, useState } from "react";
import * as emailApi from "../api/emailSettings";
import { useAuth } from "../context/AuthContext";

/** Quem pode criar assinaturas (envio recorrente por e-mail) de um relatorio?
 *
 * - Administrador da plataforma ou da colecao: sempre, desde que o servidor de e-mail esteja configurado.
 * - Editor da colecao: so quando ha lista de dominios permitidos (o servidor tambem exige isso).
 * - Leitor: nunca.
 *
 * `role` e o papel da pessoa na colecao do relatorio. O servidor de e-mail so e consultado por quem
 * pode, em tese, assinar. Em caso de falha na consulta, a assinatura simplesmente nao aparece. */
export function useSubscriptionAccess(role: string | null | undefined): {
  canSubscribe: boolean;
  allowedDomains: string[];
} {
  const { user } = useAuth();
  const isPlatformAdmin = user?.is_platform_admin ?? false;
  const mightManage = isPlatformAdmin || role === "admin" || role === "editor";
  const [status, setStatus] = useState<emailApi.EmailStatus | null>(null);

  useEffect(() => {
    if (!user || !mightManage) return;
    let cancelled = false;
    emailApi
      .getEmailStatus()
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, mightManage]);

  const allowedDomains = status?.allowed_domains ?? [];
  if (!user || !mightManage || !status?.configured) return { canSubscribe: false, allowedDomains };

  const isAdmin = isPlatformAdmin || role === "admin";
  return { canSubscribe: isAdmin || allowedDomains.length > 0, allowedDomains };
}
