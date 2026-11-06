import { useEffect, useRef, useState } from "react";
import type { Report, ReportPage } from "../api/reports";
import * as reportsApi from "../api/reports";
import { extractErrorMessage } from "../api/client";
import Modal from "./Modal";

const POLL_INTERVAL_MS = 2500;

export default function ThumbnailPickerModal({
  report,
  workspaceId,
  onDone,
  onClose,
}: {
  report: Report;
  workspaceId: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<ReportPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("queued");
  const [jobMessage, setJobMessage] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    reportsApi
      .getReportPages(workspaceId, report.id)
      .then(setPages)
      .catch((err) => setError(extractErrorMessage(err) || "Nao foi possivel carregar as paginas."))
      .finally(() => setLoading(false));
  }, [workspaceId, report.id]);

  useEffect(() => {
    if (!jobId) return;
    function poll() {
      reportsApi
        .getThumbnailJobStatus(workspaceId, report.id, jobId!)
        .then((s) => {
          setJobStatus(s.status);
          setJobMessage(s.message);
          setProgress(s.progress);
          if (s.status === "done") {
            onDone();
          } else if (s.status === "error") {
            setError(s.message);
            setJobId(null);
          } else {
            pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          }
        })
        .catch(() => {
          pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        });
    }
    pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobId, workspaceId, report.id, onDone]);

  async function handlePick(pageName: string | null) {
    setError(null);
    setProgress(0);
    try {
      const { job_id } = await reportsApi.refreshThumbnail(workspaceId, report.id, pageName);
      setJobId(job_id);
      setJobStatus("queued");
      setJobMessage("Na fila.");
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel iniciar a geracao.");
    }
  }

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      await reportsApi.clearThumbnail(workspaceId, report.id);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel remover o thumbnail.");
      setClearing(false);
    }
  }

  const exporting = jobId !== null && jobStatus !== "done" && jobStatus !== "error";

  return (
    <Modal title="Atualizar miniatura" onClose={exporting ? () => {} : onClose}>
      {!exporting && (
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          Escolha a pagina do relatorio que sera usada como miniatura do card.
        </p>
      )}

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Carregando paginas...</p>}

      {!loading && error && (
        <p role="alert" style={{ color: "var(--color-danger)", marginBottom: 12 }}>{error}</p>
      )}

      {exporting && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 8 }}>{jobMessage}</p>
          <div style={{ background: "var(--color-border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "var(--color-primary)",
                transition: "width 0.4s ease",
                minWidth: progress > 0 ? 0 : "10%",
              }}
            />
          </div>
        </div>
      )}

      {!loading && !error && !exporting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {pages.map((page) => (
            <button
              key={page.name}
              className="btn btn-secondary"
              onClick={() => handlePick(page.name)}
            >
              {page.display_name}
            </button>
          ))}
          {pages.length === 0 && (
            <button className="btn btn-secondary" onClick={() => handlePick(null)}>
              Usar pagina principal
            </button>
          )}
        </div>
      )}

      {report.thumbnail_url && !loading && !exporting && (
        <button
          className="btn btn-ghost"
          onClick={handleClear}
          disabled={clearing}
          style={{ width: "100%", marginTop: 4 }}
        >
          Remover miniatura (voltar ao embed ao vivo)
        </button>
      )}
    </Modal>
  );
}
