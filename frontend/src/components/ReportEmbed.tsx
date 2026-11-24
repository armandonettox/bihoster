import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as pbi from "powerbi-client";
import * as reportsApi from "../api/reports";
import type { PageVisualInfo } from "../api/aiChat";
import { useWorkspace } from "../context/WorkspaceContext";
import { csvHeaders } from "../utils/csvHeaders";
import { parseCsv } from "../utils/csvParse";
import { downloadBlob } from "../utils/download";
import { buildXlsx, sheetName } from "../utils/xlsx";
import { extractErrorMessage } from "../api/client";
import { createEmbedTimer } from "../utils/embedTiming";
import { getPowerBiService, isPreloadStarted } from "../utils/powerbiService";

export interface TableVisualInfo {
  name: string;
  title: string;
}

/** Uma pagina do relatorio: o nome tecnico (que o Power BI usa) e o titulo que aparece para a pessoa */
export interface ReportPageInfo {
  name: string;
  displayName: string;
}

export interface VisualMeasure {
  measure_name: string;
  table_name: string;
  visual_title: string;
}

/** A pagina ativa e os campos que cada grafico usa: vai para o chat de IA como pista dos nomes */
export interface PageContextInfo {
  page_name: string;
  page_title: string;
  visuals: PageVisualInfo[];
}

/** Como baixar os dados das tabelas: texto CSV (um arquivo por tabela) ou uma planilha Excel (uma aba por tabela) */
export type TableExportFormat = "csv" | "xlsx";

export interface ReportEmbedHandle {
  /** As tabelas da pagina aberta, se ja foram lidas (resposta na hora); null enquanto a pagina nao terminou de desenhar */
  peekTableVisuals: () => TableVisualInfo[] | null;
  getTableVisuals: () => Promise<TableVisualInfo[]>;
  /** As paginas do relatorio que a pessoa pode ver (as escolhidas para ele, sem as ocultas), se ja foram lidas; null antes */
  peekPages: () => ReportPageInfo[] | null;
  getReportPages: () => Promise<ReportPageInfo[]>;
  /** Estado do relatorio aberto (filtros e selecoes atuais), para exportar com os "valores atuais"; null se nao der */
  captureBookmarkState: () => Promise<string | null>;
  /** Baixa os dados de uma ou mais tabelas da pagina ativa (ou de todas, sem `visualNames`) no formato pedido (padrao: csv) */
  exportTableData: (visualNames?: string | string[], format?: TableExportFormat) => Promise<void>;
  getPageMeasures: () => Promise<VisualMeasure[]>;
  /** Nome tecnico da pagina ativa, ou null se o relatorio ainda nao carregou */
  getActivePageName: () => Promise<string | null>;
  /** Pagina ativa com os campos de cada grafico; null se o relatorio ainda nao carregou */
  getPageContext: () => Promise<PageContextInfo | null>;
}

const TABLE_VISUAL_TYPES = ["tableEx", "pivotTable"];
// Visuais sem dados (texto, imagem, formas e botoes): nao ha campo para ler
const NO_DATA_VISUAL_TYPES = ["textbox", "image", "shape", "basicShape", "actionButton"];
const MAX_CONTEXT_VISUALS = 40;

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
  /** Nivel de zoom aplicado ao frame (1.0 = normal, 0.8 = menor, 1.5 = maior). */
  zoom?: number;
  /** Busca a configuracao do embed por outro caminho que nao o da pessoa logada (a TV do Modo TV, que tem token proprio). */
  loadConfig?: () => Promise<reportsApi.EmbedConfig>;
  /** Abre exatamente esta pagina, sem navegacao entre paginas nem painel de filtros (um item da lista da TV). */
  forcePage?: string;
}>(function ReportEmbed({ reportId, height = 600, workspaceId, zoom = 1, loadConfig, forcePage }, ref) {
  const { currentWorkspace } = useWorkspace();
  const effectiveWorkspaceId = workspaceId ?? currentWorkspace?.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const embeddedRef = useRef<pbi.Report | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const loadConfigRef = useRef(loadConfig);
  loadConfigRef.current = loadConfig;

  // As tabelas da pagina aberta, lidas com antecedencia (quando a pagina desenha) para o Exportar abrir na hora, sem
  // esperar a ida e volta ao Power BI. Zera ao trocar de pagina.
  const tableCacheRef = useRef<TableVisualInfo[] | null>(null);
  const tableLoadRef = useRef<Promise<TableVisualInfo[]> | null>(null);

  // Conta as trocas de pagina: uma leitura que comecou antes da troca nao pode guardar as tabelas da pagina antiga
  const tablePageGenRef = useRef(0);
  // As paginas do relatorio, lidas quando ele carrega (a lista nao muda): o Exportar mostra a lista de paginas na hora
  const pagesCacheRef = useRef<ReportPageInfo[] | null>(null);
  const allowedPagesRef = useRef<string[]>([]);

  async function loadPages(report: pbi.Report): Promise<ReportPageInfo[]> {
    const pages = await report.getPages();
    const allowed = allowedPagesRef.current;
    const list = pages
      // Fora as paginas ocultas (dicas de ferramenta, detalhamento) e, com paginas escolhidas para o relatorio, as demais
      .filter((page) => page.visibility !== 1 && (allowed.length === 0 || allowed.includes(page.name)))
      .map((page) => ({ name: page.name, displayName: page.displayName }));
    if (embeddedRef.current === report) pagesCacheRef.current = list;
    return list;
  }

  function loadTableVisuals(report: pbi.Report): Promise<TableVisualInfo[]> {
    if (tableLoadRef.current) return tableLoadRef.current;
    const generation = tablePageGenRef.current;
    const load = (async () => {
      const page = await report.getActivePage();
      const visuals = await page.getVisuals();
      const list = visuals
        .filter((v) => TABLE_VISUAL_TYPES.includes(v.type))
        .map((v) => ({ name: v.name, title: v.title || v.name }));
      // So guarda se o relatorio e a pagina continuam os mesmos de quando o pedido saiu
      if (embeddedRef.current === report && tablePageGenRef.current === generation) tableCacheRef.current = list;
      return list;
    })();
    tableLoadRef.current = load;
    const release = () => {
      if (tableLoadRef.current === load) tableLoadRef.current = null;
    };
    load.then(release, release);
    return load;
  }

  useImperativeHandle(ref, () => ({
    peekTableVisuals: () => tableCacheRef.current,
    peekPages: () => pagesCacheRef.current,
    getReportPages: async () => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");
      return pagesCacheRef.current ?? loadPages(report);
    },
    captureBookmarkState: async () => {
      const report = embeddedRef.current;
      if (!report) return null;
      try {
        const bookmark = await report.bookmarksManager.capture();
        return bookmark.state || null;
      } catch {
        // Sem como capturar o estado: o arquivo sai com os valores padrao do relatorio
        return null;
      }
    },
    getTableVisuals: async () => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");
      return tableCacheRef.current ?? loadTableVisuals(report);
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
    getActivePageName: async () => {
      const report = embeddedRef.current;
      if (!report) return null;
      return (await report.getActivePage()).name;
    },
    getPageContext: async (): Promise<PageContextInfo | null> => {
      const report = embeddedRef.current;
      if (!report) return null;
      const page = await report.getActivePage();
      const visuals = (await page.getVisuals())
        .filter((v) => !NO_DATA_VISUAL_TYPES.includes(v.type))
        .slice(0, MAX_CONTEXT_VISUALS);
      const described = await Promise.all(
        visuals.map(async (visual): Promise<PageVisualInfo> => {
          let fields: string[] = [];
          try {
            // Uma linha so: o que interessa e o cabecalho, que traz "Tabela[Coluna]" de cada campo do visual
            const result = await visual.exportData(pbi.models.ExportDataType.Summarized, 1);
            fields = csvHeaders(result.data);
          } catch {
            // Visual sem permissao de exportar ou sem dados: entra so com titulo e tipo
          }
          return { title: visual.title || "", type: visual.type, fields };
        }),
      );
      return { page_name: page.name, page_title: page.displayName, visuals: described };
    },
    exportTableData: async (visualNames?: string | string[], format: TableExportFormat = "csv") => {
      const report = embeddedRef.current;
      if (!report) throw new Error("Relatorio nao carregado ainda.");

      const page = await report.getActivePage();
      const visuals = await page.getVisuals();
      const tableVisuals = visuals.filter((v) => TABLE_VISUAL_TYPES.includes(v.type));

      if (tableVisuals.length === 0) {
        throw new Error("Nenhum visual de tabela encontrado na pagina atual.");
      }

      const wanted = visualNames === undefined ? null : Array.isArray(visualNames) ? visualNames : [visualNames];
      const targets = wanted ? tableVisuals.filter((v) => wanted.includes(v.name)) : tableVisuals;

      if (targets.length === 0) {
        throw new Error("Visual nao encontrado na pagina atual.");
      }

      const errors: string[] = [];
      const exported: { label: string; csv: string }[] = [];
      for (const visual of targets) {
        try {
          const result = await visual.exportData(pbi.models.ExportDataType.Summarized);
          exported.push({ label: visual.title || visual.name || "tabela", csv: result.data });
        } catch {
          errors.push(visual.title || visual.name || "tabela");
        }
      }

      if (exported.length === 0) {
        throw new Error("Nao foi possivel exportar os dados. Verifique as permissoes do relatorio.");
      }

      if (format === "xlsx") {
        const names: string[] = [];
        const sheets = exported.map((item) => {
          const name = sheetName(item.label, names);
          names.push(name);
          return { name, rows: parseCsv(item.csv) };
        });
        const fileName = exported.length === 1 ? exported[0].label : page.displayName || "tabelas";
        const bytes = buildXlsx(sheets);
        downloadBlob(
          new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${fileName}.xlsx`,
        );
      } else {
        for (const item of exported) {
          downloadBlob(new Blob([item.csv], { type: "text/csv;charset=utf-8;" }), `${item.label}.csv`);
        }
      }
    },
  }));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Barra de abas propria: so existe quando mais de uma aba foi escolhida pro relatorio
  const [tabs, setTabs] = useState<PageTab[]>([]);
  const [activePage, setActivePage] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveWorkspaceId && !loadConfigRef.current) return;

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

    // A TV busca a configuracao pelo token dela; a pessoa logada, pelo caminho normal da colecao
    function fetchConfig() {
      const custom = loadConfigRef.current;
      return custom ? custom() : reportsApi.getEmbedConfig(effectiveWorkspaceId as number, reportId);
    }

    // Troca o token do relatorio ja aberto (sem recarregar) antes de ele vencer -- sem isso, uma
    // aba deixada aberta por mais de ~1h (ou o modo TV com um relatorio so) ficava em branco.
    function renewToken(embeddedReport: pbi.Report) {
      if (cancelled) return;
      fetchConfig()
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

    fetchConfig()
      .then((config) => {
        if (cancelled || !container) return;
        timer.mark("config");

        // Abas escolhidas na hora de adicionar (nomes tecnicos do Power BI, nao os titulos).
        // Backend antigo so manda page_name.
        const selectedPages = forcePage ? [forcePage] : (config.page_names ?? (config.page_name ? [config.page_name] : []));
        allowedPagesRef.current = selectedPages;

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
            background: pbi.models.BackgroundType.Transparent,
            bars: { actionBar: { visible: false } },
            panes: {
              filters: { visible: forcePage ? false : (config.show_filter_pane ?? false) },
              // Com abas escolhidas e show_page_nav desativado, a navegacao nativa some:
              // a barra propria abaixo assume quando ha multiplas abas selecionadas.
              pageNavigation: {
                visible: forcePage ? false : (config.show_page_nav ?? (selectedPages.length === 0)),
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
          // Outra pagina, outras tabelas: a leitura antecipada recomeca quando ela terminar de desenhar
          tablePageGenRef.current += 1;
          tableCacheRef.current = null;
          tableLoadRef.current = null;
        });

        embeddedReport.on("rendered", () => {
          timer.mark("rendered");
          timer.finish();
          // Le as tabelas da pagina logo que ela desenha, para o Exportar nao ter que procurar
          if (!tableCacheRef.current) loadTableVisuals(embeddedReport).catch(() => {});
        });

        embeddedReport.on("error", () => {
          timer.finish(true);
        });

        embeddedReport.on("loaded", async () => {
          timer.mark("loaded");
          pagesCacheRef.current = null;
          loadPages(embeddedReport).catch(() => {
            // Sem a lista, o Exportar exporta o relatorio inteiro e a janela nao mostra a escolha de paginas
          });
          if (zoomRef.current !== 1) {
            embeddedReport.setZoom(zoomRef.current).catch(() => {});
          }
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
      tablePageGenRef.current += 1;
      tableCacheRef.current = null;
      tableLoadRef.current = null;
      pagesCacheRef.current = null;
      if (renewTimer) clearTimeout(renewTimer);
      if (embedded && container) {
        getPowerBiService().reset(container);
      }
    };
  }, [reportId, effectiveWorkspaceId, forcePage]);

  useEffect(() => {
    const report = embeddedRef.current;
    if (!report) return;
    report.setZoom(zoom).catch(() => {});
  }, [zoom]);

  if (error) {
    return (
      <div className="embed-error">
        <p className="embed-error-title">Nao foi possivel exibir o relatorio</p>
        <p className="embed-error-message">{error}</p>
        <p className="embed-error-hint">
          Verifique a conexao com o Power BI em Administração {`>`} Geral, e as configuracoes do
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
