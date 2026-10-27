import { useEffect, useRef, useState } from "react";
import * as pbi from "powerbi-client";
import * as reportsApi from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import { extractErrorMessage } from "../api/client";

// O backend so entrega um token novo depois que o do cache vence (5 min antes da expiracao real),
// entao renova um pouco depois desse ponto, ainda com folga antes de o token vencer de verdade.
const RENEW_BEFORE_EXPIRY_MS = 4 * 60 * 1000;
const MIN_RENEW_DELAY_MS = 30 * 1000;
// Se a renovacao falhar (rede, backend), tenta de novo nesse intervalo ate o token vencer
const RENEW_RETRY_MS = 60 * 1000;

/** Quanto falta ate renovar o token: `expires_at` menos a margem, com piso pra nao ficar em loop. */
function msUntilRenewal(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry)) return null;
  return Math.max(MIN_RENEW_DELAY_MS, expiry - Date.now() - RENEW_BEFORE_EXPIRY_MS);
}

interface PageTab {
  name: string;
  displayName: string;
}

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
  const embeddedRef = useRef<pbi.Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Barra de abas propria: so existe quando mais de uma aba foi escolhida pro relatorio
  const [tabs, setTabs] = useState<PageTab[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveWorkspaceId) return;

    let cancelled = false;
    setTabs([]);
    setActivePage(null);
    let service: pbi.service.Service | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    setError(null);
    setLoading(true);

    // Troca o token do relatorio ja aberto (sem recarregar) antes de ele vencer -- sem isso, uma
    // aba deixada aberta por mais de ~1h (ou o modo TV com um relatorio so) ficava em branco.
    function renewToken(embeddedReport: pbi.Report) {
      if (cancelled) return;
      reportsApi
        .getEmbedConfig(effectiveWorkspaceId as number, reportId)
        .then(async (fresh) => {
          if (cancelled) return;
          await embeddedReport.setAccessToken(fresh.access_token);
          scheduleRenewal(embeddedReport, fresh.expires_at);
        })
        .catch(() => {
          // Falhou (rede, backend): tenta de novo em 1 min, enquanto o token atual ainda vale
          if (!cancelled) renewTimer = setTimeout(() => renewToken(embeddedReport), RENEW_RETRY_MS);
        });
    }

    function scheduleRenewal(embeddedReport: pbi.Report, expiresAt: string | null | undefined) {
      const delay = msUntilRenewal(expiresAt);
      if (delay === null) return;
      renewTimer = setTimeout(() => renewToken(embeddedReport), delay);
    }

    reportsApi
      .getEmbedConfig(effectiveWorkspaceId, reportId)
      .then((config) => {
        if (cancelled || !containerRef.current) return;

        service = new pbi.service.Service(
          pbi.factories.hpmFactory,
          pbi.factories.wpmpFactory,
          pbi.factories.routerFactory,
        );

        // Abas escolhidas na hora de adicionar (nomes tecnicos do Power BI, nao os titulos).
        // Backend antigo so manda page_name.
        const selectedPages = config.page_names ?? (config.page_name ? [config.page_name] : []);

        const embeddedReport = service.embed(containerRef.current, {
          type: "report",
          id: config.report_id,
          embedUrl: config.embed_url,
          accessToken: config.access_token,
          tokenType: pbi.models.TokenType.Embed,
          // Abre direto na primeira aba escolhida
          pageName: selectedPages[0],
          settings: {
            panes: {
              filters: { visible: config.show_filter_pane ?? false },
              // Com abas escolhidas e show_page_nav desativado, a navegacao nativa some:
              // a barra propria abaixo assume quando ha multiplas abas selecionadas.
              pageNavigation: {
                visible: config.show_page_nav ?? (selectedPages.length === 0),
              },
            },
          },
        }) as pbi.Report;
        embeddedRef.current = embeddedReport;

        scheduleRenewal(embeddedReport, config.expires_at);

        embeddedReport.on("pageChanged", (event) => {
          const newPage = (event.detail as { newPage?: { name?: string } } | undefined)?.newPage;
          if (newPage?.name) setActivePage(newPage.name);
        });

        embeddedReport.on("loaded", async () => {
          if (selectedPages.length > 1) {
            try {
              const pages = await embeddedReport.getPages();
              const chosen = pages
                .filter((page) => selectedPages.includes(page.name))
                .map((page) => ({ name: page.name, displayName: page.displayName }));
              if (cancelled) return;
              if (chosen.length > 1) setTabs(chosen);
              const current = pages.find((page) => page.isActive);
              if (current) setActivePage(current.name);
            } catch {
              // Sem a lista de paginas nao da pra montar a barra: fica so na primeira aba escolhida.
            }
          }
          if (selectedPages.length > 0) return;
          // Sem abas selecionadas: oculta a barra nativa se o relatorio tem uma so pagina
          // ou se o admin desativou a navegacao para este relatorio.
          if (!config.show_page_nav) {
            try {
              const pages = await embeddedReport.getPages();
              if (pages.length <= 1) {
                await embeddedReport.updateSettings({ panes: { pageNavigation: { visible: false } } });
              }
            } catch {
              // Sem problema se nao der pra checar as paginas -- fica com a barra padrao.
            }
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
      embeddedRef.current = null;
      if (renewTimer) clearTimeout(renewTimer);
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
      {tabs.length > 1 && (
        <div className="report-page-tabs" role="tablist" aria-label="Abas do relatorio">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              type="button"
              role="tab"
              aria-selected={tab.name === activePage}
              className={`btn btn-sm report-page-tab ${tab.name === activePage ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => {
                setActivePage(tab.name);
                embeddedRef.current?.setPage(tab.name).catch(() => {
                  // Falhou ao trocar: o evento pageChanged nao vem e a aba marcada volta a refletir a real
                  embeddedRef.current?.getActivePage().then((page) => setActivePage(page.name)).catch(() => {});
                });
              }}
            >
              {tab.displayName}
            </button>
          ))}
        </div>
      )}
      <div
        ref={containerRef}
        className="report-embed-frame"
        style={{ height, flex: height === "100%" ? 1 : undefined }}
      />
    </div>
  );
}
