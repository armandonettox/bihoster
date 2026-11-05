import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import { extractErrorMessage } from "../api/client";
import FullscreenHeader from "../components/FullscreenHeader";
import ReportEmbed, { type ReportEmbedHandle, type TableVisualInfo } from "../components/ReportEmbed";
import ReportAlertsModal from "../components/ReportAlertsModal";
import ReportSubscriptionsModal from "../components/ReportSubscriptionsModal";
import { useWorkspace } from "../context/WorkspaceContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useSubscriptionAccess } from "../hooks/useSubscriptionAccess";

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
  const { selectWorkspace, workspaces } = useWorkspace();

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(invalid ? "Endereco do relatorio invalido." : null);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [visualList, setVisualList] = useState<TableVisualInfo[] | null>(null);
  const embedRef = useRef<ReportEmbedHandle>(null);
  const { canSubscribe, allowedDomains } = useSubscriptionAccess(workspaces.find((w) => w.id === wsId)?.role);

  async function handleExport() {
    setExportError(null);
    setVisualList(null);
    setExporting(true);
    try {
      const visuals = await embedRef.current?.getTableVisuals();
      if (!visuals || visuals.length === 0) {
        throw new Error("Nenhum visual de tabela encontrado na pagina atual.");
      }
      if (visuals.length === 1) {
        await embedRef.current?.exportTableData(visuals[0].name);
      } else {
        setVisualList(visuals);
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar os dados.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportVisual(visualName: string) {
    setVisualList(null);
    setExportError(null);
    try {
      await embedRef.current?.exportTableData(visualName);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar os dados.");
    }
  }

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

  // Com a janela de assinaturas aberta, o Esc fecha so ela (o proprio modal cuida disso)
  useEscapeKey(exit, !subscriptionsOpen);

  return (
    <div className="fullscreen-view">
      <FullscreenHeader
        title={report?.name ?? ""}
        onExit={exit}
        actions={
          report ? (
            <>
              {visualList ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Qual tabela?</span>
                  {visualList.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      className="fullscreen-action"
                      onClick={() => handleExportVisual(v.name)}
                    >
                      {v.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="fullscreen-action"
                    onClick={() => setVisualList(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="fullscreen-action"
                  onClick={handleExport}
                  disabled={exporting}
                  title="Exportar dados de tabela como CSV"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    download
                  </span>
                  <span>{exporting ? "Exportando..." : "Exportar CSV"}</span>
                </button>
              )}
              {canSubscribe && (
                <>
                  <button
                    type="button"
                    className="fullscreen-action"
                    onClick={() => setSubscriptionsOpen(true)}
                    title="Assinaturas: envio recorrente por e-mail"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      mail
                    </span>
                    <span>Assinar</span>
                  </button>
                  <button
                    type="button"
                    className="fullscreen-action"
                    onClick={() => setAlertsOpen(true)}
                    title="Alertas: notificacao quando uma medida atingir um limite"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">
                      notifications
                    </span>
                    <span>Alertas</span>
                  </button>
                </>
              )}
            </>
          ) : undefined
        }
      />
      <div className="fullscreen-view-body">
        {exportError && (
          <p role="alert" style={{ padding: "4px 8px", color: "var(--color-danger)", fontSize: 13 }}>
            {exportError}
          </p>
        )}
        {error ? (
          <p style={{ padding: 8, color: "var(--color-danger)" }}>{error}</p>
        ) : report ? (
          <ReportEmbed ref={embedRef} key={report.id} reportId={report.id} workspaceId={wsId} height="100%" />
        ) : (
          <p style={{ padding: 8, color: "var(--color-text-muted)" }}>Carregando relatorio...</p>
        )}
      </div>
      {subscriptionsOpen && report && (
        <ReportSubscriptionsModal
          report={report}
          workspaceId={wsId}
          allowedDomains={allowedDomains}
          onClose={() => setSubscriptionsOpen(false)}
        />
      )}
      {alertsOpen && report && (
        <ReportAlertsModal
          report={report}
          workspaceId={wsId}
          onClose={() => setAlertsOpen(false)}
        />
      )}
    </div>
  );
}
