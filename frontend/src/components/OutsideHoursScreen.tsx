import { useEffect, useRef, useState } from "react";
import * as extensionsApi from "../api/accessExtensions";
import type { ExtensionRequest } from "../api/accessExtensions";
import { extractErrorMessage } from "../api/client";
import { formatNextOpen } from "../utils/outsideHours";
import type { OutsideHoursInfo } from "../utils/outsideHours";
import { formatPersonName } from "../utils/personName";

interface Props {
  info: OutsideHoursInfo;
  retrying?: boolean;
  onRetry: () => void;
  onLeave: () => void;
  /** De quanto em quanto tempo pergunta se o pedido foi respondido (testes usam um valor curto) */
  pollMs?: number;
}

const MIN_REASON = 5;

/** Tela inteira para quem está fora do horário de acesso: mostra o horário permitido e quando o acesso volta, e deixa
 * pedir mais tempo (com o motivo). Não usa nada do app (menu, contextos), porque o servidor recusa qualquer pedido nesse
 * momento, menos os de pedir mais tempo. Com um pedido aberto, pergunta de tempos em tempos e entra sozinha quando liberam. */
export default function OutsideHoursScreen({ info, retrying = false, onRetry, onLeave, pollMs = 15000 }: Props) {
  const nextOpen = formatNextOpen(info);
  const [request, setRequest] = useState<ExtensionRequest | null>(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;

  async function refresh() {
    try {
      const latest = await extensionsApi.getMyRequest();
      setRequest(latest);
      // Liberaram: o acesso ja vale, entra sozinha
      if (latest?.status === "approved" && latest.active) retryRef.current();
    } catch {
      // Sem rede ou sem sessao: o aviso continua e o botao Tentar novamente segue valendo
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const pending = request?.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [pending, pollMs]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      setRequest(await extensionsApi.requestMoreTime(reason.trim()));
      setReason("");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível enviar o pedido. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  // Ultima resposta (recusa ou liberacao que ja acabou) aparece junto do formulario de pedir de novo
  const answered = request && request.status !== "pending" ? request : null;

  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <h1 className="auth-title">Fora do horário de acesso</h1>
        <p className="auth-subtitle">
          {nextOpen ? `O seu acesso volta em ${nextOpen}.` : "Você não pode usar o sistema neste momento."}
        </p>

        {info.windows.length > 0 && (
          <div className="field">
            <span>Seu horário de acesso</span>
            <ul className="outside-hours-windows">
              {info.windows.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {info.timezone && <span className="field-hint">Horário de {info.timezone}.</span>}
          </div>
        )}

        <section className="outside-hours-request" aria-label="Pedir mais tempo">
          {pending ? (
            <>
              <strong>Pedido enviado</strong>
              <p className="field-hint">Aguardando alguém liberar. Esta tela entra sozinha quando o pedido for aprovado.</p>
              <p className="field-hint">Seu motivo: {request?.reason}</p>
            </>
          ) : (
            <>
              <strong>Precisa de mais tempo?</strong>
              {answered?.status === "denied" && (
                <p className="auth-error" role="status">
                  Seu último pedido foi recusado{answered.decided_by_name ? ` por ${formatPersonName(answered.decided_by_name)}` : ""}
                  {answered.note ? `: ${answered.note}` : "."}
                </p>
              )}
              {answered && answered.status !== "denied" && (
                <p className="field-hint" role="status">
                  A liberação do seu último pedido terminou.
                </p>
              )}
              <label className="field">
                Motivo do pedido
                <textarea
                  className="input"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: preciso fechar o relatório do mês"
                  disabled={sending}
                />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <button type="button" className="btn btn-secondary" onClick={send} disabled={sending || reason.trim().length < MIN_REASON}>
                {sending ? "Enviando..." : "Pedir mais tempo"}
              </button>
            </>
          )}
        </section>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onRetry} disabled={retrying}>
            {retrying ? "Verificando..." : "Tentar novamente"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
