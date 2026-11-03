import type { Report } from "../api/reports";
import ReportEmbed from "./ReportEmbed";

// Um relatorio so em tela cheia (o Esc e tratado pela pagina que abriu).
export default function FullscreenSingleReport({
  collectionName,
  report,
  onExit,
}: {
  collectionName: string;
  report: Report;
  onExit: () => void;
}) {
  return (
    <div className="fullscreen-view">
      <div className="fullscreen-view-header">
        <div>
          <span style={{ fontWeight: 700 }}>{collectionName}</span>
          <span style={{ color: "var(--color-text-muted)", marginLeft: 10 }}>{report.name}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          Sair (Esc)
        </button>
      </div>
      <div className="fullscreen-view-body">
        <ReportEmbed key={report.id} reportId={report.id} height="100%" />
      </div>
    </div>
  );
}
