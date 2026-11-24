import { createPortal } from "react-dom";
import { dismissExportJob, useExportJobs } from "../utils/exportJobs";

/** Os avisos das exportacoes em segundo plano, no canto da tela: animacao enquanto exporta, "pronto" ao terminar e o
 * motivo quando falha. Solto no body para aparecer tambem por cima da tela cheia do relatorio. */
export default function ExportJobsTray() {
  const jobs = useExportJobs();
  if (jobs.length === 0) return null;

  return createPortal(
    <div className="export-tray" aria-label="Exportações">
      {jobs.map((job) => (
        <div key={job.id} className={`export-tray-item export-tray-${job.state}`} role={job.state === "error" ? "alert" : "status"}>
          <span className="export-tray-icon" aria-hidden="true">
            {job.state === "running" && <span className="export-spinner" />}
            {job.state === "done" && <span className="material-symbols-outlined">check_circle</span>}
            {job.state === "error" && <span className="material-symbols-outlined">error</span>}
          </span>
          <div className="export-tray-text">
            <strong>{job.state === "running" ? `Exportando ${job.label}...` : job.label}</strong>
            <span>{job.message}</span>
            {job.state === "running" && (
              <span className="export-tray-bar" aria-hidden="true">
                <span
                  className={job.progress ? "export-tray-bar-fill" : "export-tray-bar-fill export-tray-bar-wait"}
                  style={job.progress ? { width: `${Math.min(100, job.progress)}%` } : undefined}
                />
              </span>
            )}
          </div>
          {job.state !== "running" && (
            <button type="button" className="export-tray-close" onClick={() => dismissExportJob(job.id)} aria-label="Fechar aviso">
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
