import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import { extractErrorMessage } from "../api/client";
import ChatPanel from "../components/ChatPanel";
import ChatPanelToggle from "../components/ChatPanelToggle";
import FullscreenHeader from "../components/FullscreenHeader";
import ExportMenu from "../components/ExportMenu";
import ReportEmbed, { type ReportEmbedHandle } from "../components/ReportEmbed";
import ReportAlertsModal from "../components/ReportAlertsModal";
import ReportSubscriptionsModal from "../components/ReportSubscriptionsModal";
import { useAccess } from "../context/AccessContext";
import { useChat } from "../context/ChatContext";
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
  const { selectWorkspace } = useWorkspace();
  const { setOpenReport } = useChat();

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(invalid ? "Endereco do relatorio invalido." : null);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const embedRef = useRef<ReportEmbedHandle>(null);
  const [zoom, setZoom] = useState(1.0);
  const [showZoomHint, setShowZoomHint] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(false);
  const { canSubscribe, canAlert, subscriptions, alerts, allowedDomains } = useSubscriptionAccess(wsId);
  // PDF e imagem saem do sistema, entao pedem a permissao de exportar na colecao (o servidor confere de novo)
  const canExportFile = useAccess().canInReport("relatorio.exportar", repId, wsId);

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  function zoomIn() {
    setZoom((z) => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(1))));
  }
  function zoomOut() {
    setZoom((z) => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(1))));
  }
  function zoomReset() {
    setZoom(1.0);
  }

  useEffect(() => {
    if (!showZoomHint) return;
    const t = setTimeout(() => setShowZoomHint(false), 3500);
    return () => clearTimeout(t);
  }, [showZoomHint]);

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

  // Avisa o chat de IA qual relatorio esta aberto: ele le a pagina ativa e os campos dos graficos so na hora de
  // perguntar, e pede a imagem da pagina se o admin liberou
  useEffect(() => {
    if (!report) return;
    setOpenReport({
      reportId: report.id,
      getPageName: async () => (await embedRef.current?.getActivePageName()) ?? null,
      getContext: async () => (await embedRef.current?.getPageContext()) ?? null,
    });
    return () => setOpenReport(null);
  }, [report, setOpenReport]);

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
    <div className="fullscreen-view fullscreen-view-with-chat">
      <div className="fullscreen-main">
      <div className={`fullscreen-header-wrap${headerVisible ? "" : " fullscreen-header-wrap--hidden"}`}>
        <FullscreenHeader
          title={report?.name ?? ""}
          onExit={exit}
        actions={
          report ? (
            <>
              <div className="zoom-controls" role="group" aria-label="Controles de zoom">
                <button
                  type="button"
                  className="fullscreen-action zoom-btn"
                  onClick={zoomOut}
                  disabled={zoom <= ZOOM_MIN}
                  title="Reduzir zoom"
                  aria-label="Reduzir zoom"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">remove</span>
                </button>
                <span className="zoom-level" aria-live="polite" aria-label={`Zoom atual: ${Math.round(zoom * 100)}%`}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="fullscreen-action zoom-btn"
                  onClick={zoomIn}
                  disabled={zoom >= ZOOM_MAX}
                  title="Aumentar zoom"
                  aria-label="Aumentar zoom"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">add</span>
                </button>
                <button
                  type="button"
                  className="fullscreen-action zoom-btn"
                  onClick={zoomReset}
                  disabled={zoom === 1.0}
                  title="Ajustar a tela (100%)"
                  aria-label="Ajustar a tela"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">fit_screen</span>
                </button>
              </div>
              <ExportMenu embedRef={embedRef} workspaceId={wsId} reportId={repId} canExportFile={canExportFile} />
              {canSubscribe && (
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
              )}
              {canAlert && (
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
              )}
              <ChatPanelToggle className="fullscreen-action" showLabel />
            </>
          ) : undefined
        }
        />
      </div>
      <button
        type="button"
        className={`fullscreen-header-toggle${headerVisible ? " fullscreen-header-toggle--open" : ""}`}
        onClick={() => setHeaderVisible((v) => !v)}
        title={headerVisible ? "Ocultar barra" : "Mostrar barra"}
        aria-label={headerVisible ? "Ocultar barra superior" : "Mostrar barra superior"}
      >
        <span className="material-symbols-outlined">
          {headerVisible ? "keyboard_arrow_up" : "keyboard_arrow_down"}
        </span>
      </button>
      <div className="fullscreen-view-body" style={{ position: "relative" }}>
        {showZoomHint && report && (
          <div className={`zoom-hint${showZoomHint ? "" : " zoom-hint--hidden"}`} aria-hidden="true">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>zoom_in</span>
            Use + / - para ajustar o zoom
          </div>
        )}
        {error ? (
          <p style={{ padding: 8, color: "var(--color-danger)" }}>{error}</p>
        ) : report ? (
          <ReportEmbed ref={embedRef} key={report.id} reportId={report.id} workspaceId={wsId} height="100%" zoom={zoom} />
        ) : (
          <p style={{ padding: 8, color: "var(--color-text-muted)" }}>Carregando relatorio...</p>
        )}
      </div>
      </div>
      <ChatPanel />
      {subscriptionsOpen && report && (
        <ReportSubscriptionsModal
          report={report}
          workspaceId={wsId}
          allowedDomains={allowedDomains}
          can={subscriptions}
          onClose={() => setSubscriptionsOpen(false)}
        />
      )}
      {alertsOpen && report && (
        <ReportAlertsModal
          report={report}
          workspaceId={wsId}
          embedRef={embedRef}
          can={alerts}
          onClose={() => setAlertsOpen(false)}
        />
      )}
    </div>
  );
}
