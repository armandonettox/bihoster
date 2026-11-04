import { useEffect, useState, type FormEvent } from "react";
import * as deliveryApi from "../api/reportDelivery";
import type { DeliveryStatus, ExportFormat } from "../api/reportDelivery";
import type { Report } from "../api/reports";
import { extractErrorMessage } from "../api/client";
import Modal from "./Modal";

const POLL_MS = 2000;
// A exportacao pode levar minutos; passado disso a janela para de acompanhar (o envio segue no servidor)
const GIVE_UP_MS = 6 * 60 * 1000;

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "PDF", label: "PDF" },
  { value: "PNG", label: "Imagem (PNG)" },
  { value: "PPTX", label: "PowerPoint (PPTX)" },
];

/** Exporta o relatorio no Power BI e manda por e-mail, mostrando o andamento. O trabalho roda no
 * servidor: fechar a janela nao o cancela. */
export default function SendReportEmailModal({
  report,
  workspaceId,
  defaultEmail,
  onClose,
}: {
  report: Report;
  workspaceId: number;
  defaultEmail: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(defaultEmail);
  const [format, setFormat] = useState<ExportFormat>("PDF");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  // Acompanha o envio ate terminar (ou ate desistir de esperar)
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function poll() {
      try {
        const current = await deliveryApi.getDeliveryStatus(workspaceId, jobId as string);
        if (cancelled) return;
        setStatus(current);
        if (current.status === "done" || current.status === "error") return;
      } catch {
        // Falha pontual de rede: tenta de novo no proximo ciclo
      }
      if (cancelled) return;
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, workspaceId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      setJobId(await deliveryApi.exportReportByEmail(workspaceId, report.id, to.trim(), format));
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel iniciar o envio.");
    } finally {
      setSubmitting(false);
    }
  }

  const finished = status?.status === "done" || status?.status === "error";
  const running = jobId !== null && !finished && !gaveUp;

  return (
    <Modal title="Enviar por e-mail" onClose={onClose}>
      {jobId === null ? (
        <form onSubmit={handleSubmit}>
          <p style={{ marginTop: 0, color: "var(--color-text-muted)", fontSize: 14 }}>
            O relatorio <strong>{report.name}</strong> sera exportado no Power BI e enviado como anexo.
          </p>
          <label className="field">
            Enviar para
            <input
              className="input"
              type="email"
              required
              autoFocus
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="nome@empresa.com"
            />
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            Formato
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting || !to.trim()}>
              {submitting ? "Enviando..." : "Enviar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p
            role="status"
            style={{
              marginTop: 0,
              fontWeight: 600,
              color: status?.status === "error" ? "var(--color-danger)" : "var(--color-text)",
            }}
          >
            {gaveUp ? "O envio esta demorando mais que o normal." : (status?.message ?? "Iniciando o envio...")}
          </p>
          {running && status?.status === "exporting" && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status.progress}
              style={{ height: 6, borderRadius: 3, background: "var(--color-border)", overflow: "hidden", marginBottom: 12 }}
            >
              <div style={{ width: `${status.progress}%`, height: "100%", background: "var(--color-secondary)" }} />
            </div>
          )}
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            {finished
              ? status?.status === "done"
                ? `Enviado para ${to.trim()}. Pode demorar alguns minutos para chegar.`
                : "Nada foi enviado."
              : gaveUp
                ? "Ele continua no servidor: confira a caixa de entrada mais tarde."
                : "A exportacao leva de alguns segundos a alguns minutos. Pode fechar esta janela: o envio continua em segundo plano."}
          </p>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginTop: 8 }}>
            {finished || gaveUp ? "Fechar" : "Fechar e continuar em segundo plano"}
          </button>
        </div>
      )}
    </Modal>
  );
}
