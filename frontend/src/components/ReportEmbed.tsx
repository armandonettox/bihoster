import { useEffect, useRef, useState } from "react";
import * as pbi from "powerbi-client";
import * as reportsApi from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import { extractErrorMessage } from "../api/client";

export default function ReportEmbed({
  reportId,
  height = 600,
  workspaceId,
}: {
  reportId: number;
  height?: number | string;
  /** Sobrescreve a colecao atual do contexto -- necessario para exibir relatorios de
   * outras colecoes, como na playlist do modo TV. */
  workspaceId?: number;
}) {
  const { currentWorkspace } = useWorkspace();
  const effectiveWorkspaceId = workspaceId ?? currentWorkspace?.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!effectiveWorkspaceId) return;

    let cancelled = false;
    let service: pbi.service.Service | null = null;
    setError(null);
    setLoading(true);

    reportsApi
      .getEmbedConfig(effectiveWorkspaceId, reportId)
      .then((config) => {
        if (cancelled || !containerRef.current) return;

        service = new pbi.service.Service(
          pbi.factories.hpmFactory,
          pbi.factories.wpmpFactory,
          pbi.factories.routerFactory,
        );

        const embeddedReport = service.embed(containerRef.current, {
          type: "report",
          id: config.report_id,
          embedUrl: config.embed_url,
          accessToken: config.access_token,
          tokenType: pbi.models.TokenType.Embed,
          settings: {
            panes: { filters: { visible: false } },
          },
        }) as pbi.Report;

        embeddedReport.on("loaded", async () => {
          try {
            const pages = await embeddedReport.getPages();
            if (pages.length <= 1) {
              await embeddedReport.updateSettings({ panes: { pageNavigation: { visible: false } } });
            }
          } catch {
            // Sem problema se nao der pra checar as paginas -- fica com a barra padrao.
          }
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(extractErrorMessage(err) || "Nao foi possivel carregar o relatorio do Power BI.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (service && containerRef.current) {
        service.reset(containerRef.current);
      }
    };
  }, [reportId, effectiveWorkspaceId]);

  if (error) {
    return (
      <div className="embed-error">
        <p className="embed-error-title">Nao foi possivel exibir o relatorio</p>
        <p className="embed-error-message">{error}</p>
        <p className="embed-error-hint">
          Verifique a conexao com o Power BI em Configuracoes {`>`} Power BI, e as configuracoes do
          locatario do Power BI (embedding, entidades de servico).
        </p>
      </div>
    );
  }

  return (
    <div className="report-embed-wrapper">
      {loading && (
        <div
          className="skeleton report-embed-skeleton"
          style={{ height: height === "100%" ? "100%" : height }}
        />
      )}
      <div
        ref={containerRef}
        className="report-embed-frame"
        style={{ height, flex: height === "100%" ? 1 : undefined }}
      />
    </div>
  );
}
