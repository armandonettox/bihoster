import { useEffect, useState } from "react";
import * as deliveryApi from "../api/reportDelivery";

const POLL_MS = 2000;
const GIVE_UP_MS = 6 * 60 * 1000;

/** Acompanha um envio manual ate terminar, mostrando a mensagem do servidor. */
export default function SubscriptionRunProgress({
  workspaceId,
  jobId,
  onFinished,
}: {
  workspaceId: number;
  jobId: string;
  onFinished: () => void;
}) {
  const [message, setMessage] = useState("Iniciando o envio...");
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    async function poll() {
      try {
        const current = await deliveryApi.getDeliveryStatus(workspaceId, jobId);
        if (cancelled) return;
        setMessage(current.message || "Enviando...");
        if (current.status === "done" || current.status === "error") return onFinished();
      } catch {
        // Falha pontual de rede: tenta de novo no proximo ciclo
      }
      if (cancelled) return;
      if (Date.now() - startedAt > GIVE_UP_MS) return onFinished();
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, jobId]);
  return (
    <p role="status" style={{ margin: "6px 0 0", fontSize: 13 }}>
      {message}
    </p>
  );
}
