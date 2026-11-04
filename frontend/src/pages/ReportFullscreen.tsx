import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import { extractErrorMessage } from "../api/client";
import FullscreenHeader from "../components/FullscreenHeader";
import ReportEmbed from "../components/ReportEmbed";
import { useWorkspace } from "../context/WorkspaceContext";
import { useEscapeKey } from "../hooks/useEscapeKey";

/** Um relatorio em tela cheia, como pagina propria (/collection/:colecao/report/:relatorio).
 *
 * Ser uma pagina, e nao so um estado da tela da colecao, resolve a saida: o botao Voltar do
 * navegador sai sempre, com o foco onde estiver (inclusive dentro do Power BI, de onde o Esc nao
 * chega), o F5 nao joga a pessoa de volta pra colecao e o endereco pode ser compartilhado. */
export default function ReportFullscreen() {
  const { workspaceId, reportId } = useParams();
  const wsId = Number(workspaceId);
  const repId = Number(reportId);
  const invalid = !Number.isInteger(wsId) || !Number.isInteger(repId);

  const navigate = useNavigate();
  const location = useLocation();
  const { selectWorkspace } = useWorkspace();

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(invalid ? "Endereco do relatorio invalido." : null);

  useEffect(() => {
    if (invalid) return;
    let cancelled = false;
    reportsApi
      .getReport(wsId, repId)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err) || "Nao foi possivel abrir o relatorio.");
      });
    return () => {
      cancelled = true;
    };
  }, [wsId, repId, invalid]);

  // O nome do relatorio vai pro titulo da aba (o cabecalho mostra so a logo)
  useEffect(() => {
    if (!report) return;
    const anterior = document.title;
    document.title = `${report.name} - ${anterior}`;
    return () => {
      document.title = anterior;
    };
  }, [report]);

  const exit = useCallback(() => {
    // Chave "default" = primeira entrada do historico (endereco aberto direto, sem pagina anterior
    // do app): nao ha pra onde voltar, entao vai para a colecao.
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    selectWorkspace(wsId);
    navigate("/collection", { replace: true });
  }, [location.key, navigate, selectWorkspace, wsId]);

  useEscapeKey(exit);

  return (
    <div className="fullscreen-view">
      <FullscreenHeader title={report?.name ?? ""} onExit={exit} />
      <div className="fullscreen-view-body">
        {error ? (
          <p style={{ padding: 8, color: "var(--color-danger)" }}>{error}</p>
        ) : report ? (
          <ReportEmbed key={report.id} reportId={report.id} workspaceId={wsId} height="100%" />
        ) : (
          <p style={{ padding: 8, color: "var(--color-text-muted)" }}>Carregando relatorio...</p>
        )}
      </div>
    </div>
  );
}
