import { useEffect, useState } from "react";
import * as emailApi from "../api/emailSettings";
import { useAccess } from "../context/AccessContext";
import { useAuth } from "../context/AuthContext";

export interface SubscriptionAccess {
  /** Mostra o botao das assinaturas: pode ver as assinaturas da colecao e o servidor de e-mail esta configurado */
  canSubscribe: boolean;
  /** Mostra o botao dos alertas: pode ver os alertas da colecao e o servidor de e-mail esta configurado */
  canAlert: boolean;
  /** O que a pessoa pode fazer dentro da janela de assinaturas */
  subscriptions: { create: boolean; edit: boolean; delete: boolean; run: boolean };
  /** O que a pessoa pode fazer dentro da janela de alertas */
  alerts: { create: boolean; edit: boolean; delete: boolean };
  allowedDomains: string[];
}

/** O que a pessoa pode fazer com assinaturas (envio recorrente por e-mail) e alertas de um relatorio, na colecao dele.
 *
 * Cada acao tem a sua permissao na colecao (assinatura.ver, criar, editar, excluir, executar; alerta.ver, criar, editar,
 * excluir). Criar assinatura tambem exige haver lista de dominios permitidos, a nao ser que a pessoa tenha a permissao
 * de enviar para qualquer dominio (o servidor tambem exige isso). O servidor de e-mail so e consultado por quem pode ver
 * assinaturas ou alertas. Em caso de falha na consulta, os botoes simplesmente nao aparecem. */
export function useSubscriptionAccess(workspaceId: number | null | undefined): SubscriptionAccess {
  const { user } = useAuth();
  const access = useAccess();
  const can = (key: string) => access.canIn(key, workspaceId);
  const mightUse = can("assinatura.ver") || can("alerta.ver");
  const [status, setStatus] = useState<emailApi.EmailStatus | null>(null);

  useEffect(() => {
    if (!user || !mightUse) return;
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
  }, [user, mightUse]);

  const allowedDomains = status?.allowed_domains ?? [];
  const configured = Boolean(user && status?.configured);
  const noDomainLimit = can("assinatura.qualquer-dominio") || allowedDomains.length > 0;

  return {
    canSubscribe: configured && can("assinatura.ver"),
    canAlert: configured && can("alerta.ver"),
    subscriptions: {
      create: can("assinatura.criar") && noDomainLimit,
      // Editar e enviar agora tambem esbarram na lista de dominios, como no servidor
      edit: can("assinatura.editar") && noDomainLimit,
      delete: can("assinatura.excluir"),
      run: can("assinatura.executar") && noDomainLimit,
    },
    alerts: { create: can("alerta.criar"), edit: can("alerta.editar"), delete: can("alerta.excluir") },
    allowedDomains,
  };
}
