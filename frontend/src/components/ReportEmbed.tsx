import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as pbi from "powerbi-client";
import * as reportsApi from "../api/reports";
import { useWorkspace } from "../context/WorkspaceContext";
import { extractErrorMessage } from "../api/client";
import { createEmbedTimer } from "../utils/embedTiming";
import { getPowerBiService, isPreloadStarted } from "../utils/powerbiService";

export interface TableVisualInfo {
  name: string;
  title: string;
}

export interface VisualMeasure {
  measure_name: string;
  table_name: string;
  visual_title: string;
}

export interface ReportEmbedHandle {
  getTableVisuals: () => Promise<TableVisualInfo[]>;
  exportTableData: (visualName?: string) => Promise<void>;
  getPageMeasures: () => Promise<VisualMeasure[]>;
}

const TABLE_VISUAL_TYPES = ["tableEx", "pivotTable"];

function downloadCsv(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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

const ReportEmbed = forwardRef<ReportEmbedHandle, {
  reportId: number;
  height?: number | string;
  /** Sobrescreve a colecao atual do contexto -- necessario para exibir relatorios de
   * outras colecoes, como na playlist do modo TV. */
  workspaceId?: number;
}>(function ReportEmbed({ reportId, height = 600, workspaceId }, ref) {
  const { currentWorkspace } = useWorkspace();
  const effectiveWorkspaceId = workspaceId ?? currentWorkspace?.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const embeddedRef = useRef<pbi.Report | null>(null);

  useImperativeHandle(ref, () => ({
    getTableVisuals: async () => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");
      const page = await report.getActivePage();
      const visuals = await page.getVisuals();
      return visuals
        .filter((v) => TABLE_VISUAL_TYPES.includes(v.type))
        .map((v) => ({ name: v.name, title: v.title || v.name }));
    },
    getPageMeasures: async (): Promise<VisualMeasure[]> => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");
      const page = await report.getActivePage();
      const visuals = await page.getVisuals();
      const measures: VisualMeasure[] = [];
      for (const visual of visuals) {
        try {
          // Exporta so os cabecalhos (1 linha) para inferir os campos do visual
          const result = await visual.exportData(pbi.models.ExportDataType.Summarized);
          if (!result.data) continue;
          const firstLine = result.data.split("\n")[0] ?? "";
          const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
          const visualTitle = visual.title || visual.name;
          for (const header of headers) {
            if (!header) continue;
            // Formato "Tabela[Medida]" ou so "Medida"
            const match = header.match(/^(.+)\[(.+)\]$/) ?? header.match(/^\[(.+)\]$/);
            if (match && match.length === 3) {
              measures.push({ table_name: match[1], measure_name: match[2], visual_title: visualTitle });
            } else if (match && match.length === 2) {
              measures.push({ table_name: "", measure_name: match[1], visual_title: visualTitle });
            } else {
              measures.push({ table_name: "", measure_name: header, visual_title: visualTitle });
            }
          }
        } catch {
          // Visual sem dados ou sem permissao de exportar -- ignorar
        }
      }
      // Deduplicar por measure_name + table_name
      const seen = new Set<string>();
      return measures.filter((m) => {
        const key = `${m.table_name}|${m.measure_name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    exportTableData: async (visualName?: string) => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");

      const page = await report.getActivePage();
      const visuals = await page.getVisuals();
      const tableVisuals = visuals.filter((v) => TABLE_VISUAL_TYPES.includes(v.type));

      if (tableVisuals.length === 0) {
        throw new Error("Nenhum visual de tabela encontrado na pagina atual.");
      }

      const targets = visualName
        ? tableVisuals.filter((v) => v.name === visualName)
        : tableVisuals;

      if (targets.length === 0) {
        throw new Error("Visual nao encontrado na pagina atual.");
      }

      const errors: string[] = [];
      for (const visual of targets) {
        try {
          const result = await visual.exportData(pbi.models.ExportDataType.Summarized);
          const label = visual.title || visual.name || "tabela";
          downloadCsv(result.data, `${label}.csv`);
        } catch {
          errors.push(visual.title || visual.name || "tabela");
        }
      }

      if (errors.length > 0 && errors.length === targets.length) {
        throw new Error("Nao foi possivel exportar os dados. Verifique as permissoes do relatorio.");
      }
    },
  }));
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
    const timer = createEmbedTimer(reportId, { preloaded: isPreloadStarted() });
    // O elemento e guardado agora: quando o cleanup roda, o React ja zerou containerRef.current, e o
    // reset do servico compartilhado nunca seria chamado (os embeds ficariam registrados nele).
    const container = containerRef.current;
    let embedded = false;
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
        if (cancelled || !container) return;
        timer.mark("config");

        // Abas escolhidas na hora de adicionar (nomes tecnicos do Power BI, nao os titulos).
        // Backend antigo so manda page_name.
        const selectedPages = config.page_names ?? (config.page_name ? [config.page_name] : []);

        timer.mark("embed");
        embedded = true;
        const embeddedReport = getPowerBiService().embed(container, {
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
            // Cabecalho do visual (menu "..."): so visivel quando habilitado no relatorio.
            // Expoe os botoes nativos: exportar dados, mostrar como tabela, modo foco, classificar.
            visualSettings: {
              visualHeaders: [{ settings: { visible: config.show_visual_header ?? false } }],
            },
          },
        }) as pbi.Report;
        embeddedRef.current = embeddedReport;

        scheduleRenewal(embeddedReport, config.expires_at);

        embeddedReport.on("pageChanged", (event) => {
          const newPage = (event.detail as { newPage?: { name?: string } } | undefined)?.newPage;
          if (newPage?.name) setActivePage(newPage.name);
        });

        embeddedReport.on("rendered", () => {
          timer.mark("rendered");
          timer.finish();
        });

        embeddedReport.on("error", () => {
          timer.finish(true);
        });

        embeddedReport.on("loaded", async () => {
          timer.mark("loaded");
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
        timer.finish(true);
        setError(extractErrorMessage(err) || "Nao foi possivel carregar o relatorio do Power BI.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      embeddedRef.current = null;
      if (renewTimer) clearTimeout(renewTimer);
      if (embedded && container) {
        getPowerBiService().reset(container);
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
});

export default ReportEmbed;
