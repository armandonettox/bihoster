import { useEffect, useState } from "react";
import * as extensionsApi from "../api/accessExtensions";
import type { ExtensionRequest } from "../api/accessExtensions";
import { extractErrorMessage } from "../api/client";
import { useAccess } from "../context/AccessContext";
import { useToast } from "../context/ToastContext";
import { formatDateTime } from "../utils/datetime";
import { formatPersonName } from "../utils/personName";
import Modal from "./Modal";

const DURATIONS = [
  { value: "30", label: "30 minutos" },
  { value: "60", label: "1 hora" },
  { value: "120", label: "2 horas" },
  { value: "240", label: "4 horas" },
  { value: "480", label: "8 horas" },
  { value: "time", label: "Até um horário de hoje" },
];

type Deciding = { kind: "approve" | "deny"; request: ExtensionRequest } | null;

/** Para quem pode liberar acesso fora do horário: os pedidos de mais tempo esperando resposta e as liberações que ainda
 * estão valendo (com a opção de encerrar). Some sozinho quando não há nada disso. */
export default function AccessRequestsPanel({ timezone }: { timezone?: string }) {
  const access = useAccess();
  const allowed = access.can("membros.liberar-horario");
  const { showToast } = useToast();
  const [items, setItems] = useState<ExtensionRequest[]>([]);
  const [deciding, setDeciding] = useState<Deciding>(null);
  const [duration, setDuration] = useState("120");
  const [untilTime, setUntilTime] = useState("22:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setItems(await extensionsApi.listExtensionRequests());
    } catch {
      // Sem a lista o painel simplesmente nao aparece; o resto da tela funciona
    }
  }

  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed) return null;
  const pending = items.filter((i) => i.status === "pending");
  const active = items.filter((i) => i.active);
  if (pending.length === 0 && active.length === 0) return null;

  function close() {
    setDeciding(null);
    setNote("");
    setDuration("120");
  }

  async function run(action: () => Promise<unknown>, success: string, fallback: string) {
    setSaving(true);
    try {
      await action();
      showToast(success);
      close();
      await load();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || fallback, "error");
    } finally {
      setSaving(false);
    }
  }

  function confirmApprove(request: ExtensionRequest) {
    const input = duration === "time" ? { until_time: untilTime } : { minutes: Number(duration) };
    return run(
      () => extensionsApi.approveRequest(request.id, input),
      `Acesso liberado para ${formatPersonName(request.user_name || "a pessoa")}.`,
      "Não foi possível liberar o acesso.",
    );
  }

  return (
    <section className="access-requests" aria-label="Pedidos de horário">
      <h3 style={{ margin: 0, fontSize: 15 }}>Pedidos de horário{pending.length > 0 ? ` (${pending.length})` : ""}</h3>

      {pending.map((request) => (
        <div key={request.id} className="access-request">
          <div>
            <strong>{formatPersonName(request.user_name || request.user_email || "Pessoa removida")}</strong>
            {request.created_at && (
              <span className="field-hint"> pediu mais tempo em {formatDateTime(request.created_at, timezone)}</span>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>{request.reason}</p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDeciding({ kind: "approve", request })}>
              Aprovar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeciding({ kind: "deny", request })}>
              Recusar
            </button>
          </div>
        </div>
      ))}

      {active.map((request) => (
        <div key={request.id} className="access-request">
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{formatPersonName(request.user_name || request.user_email || "Pessoa removida")}</strong> está liberada até{" "}
            {request.grant_until ? formatDateTime(request.grant_until, timezone) : "o fim do prazo"}.
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={saving}
            onClick={() => run(() => extensionsApi.revokeRelease(request.id), "Liberação encerrada.", "Não foi possível encerrar a liberação.")}
          >
            Encerrar liberação
          </button>
        </div>
      ))}

      {deciding?.kind === "approve" && (
        <Modal title="Liberar acesso" onClose={close}>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
            {formatPersonName(deciding.request.user_name || "A pessoa")} poderá usar o sistema por um tempo, mesmo fora do horário. Depois
            disso, o horário normal volta sozinho.
          </p>
          <p style={{ fontSize: 13 }}>Motivo: {deciding.request.reason}</p>
          <label className="field">
            Por quanto tempo
            <select className="input" value={duration} onChange={(e) => setDuration(e.target.value)} disabled={saving}>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {duration === "time" && (
            <label className="field">
              Até as
              <input className="input" type="time" value={untilTime} onChange={(e) => setUntilTime(e.target.value)} disabled={saving} />
              <span className="field-hint">No fuso do sistema. Se o horário já passou hoje, vale até o de amanhã (no máximo 24 horas).</span>
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={() => confirmApprove(deciding.request)}>
              {saving ? "Liberando..." : "Liberar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}

      {deciding?.kind === "deny" && (
        <Modal title="Recusar pedido" onClose={close}>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 0 }}>
            A pessoa vê que o pedido foi recusado, e o motivo se você escrever um.
          </p>
          <label className="field">
            Motivo da recusa (opcional)
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={saving}
              onClick={() => run(() => extensionsApi.denyRequest(deciding.request.id, note.trim()), "Pedido recusado.", "Não foi possível recusar o pedido.")}
            >
              {saving ? "Recusando..." : "Recusar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
