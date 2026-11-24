import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import * as deliveryApi from "../api/reportDelivery";
import { startExportJob, useExportJobs } from "../utils/exportJobs";
import ExportFormatIcon, { type ExportFormatKind } from "./ExportFormatIcon";
import ExportJobsTray from "./ExportJobsTray";
import MultiSelect from "./MultiSelect";
import type { ReportEmbedHandle, ReportPageInfo, TableVisualInfo } from "./ReportEmbed";

type Format = ExportFormatKind;
type ValuesMode = "current" | "default";
type ProgressUpdate = Parameters<Parameters<typeof startExportJob>[1]>[0];

// Consulta o andamento logo no comeco (exportacao pequena termina em segundos) e depois a cada segundo
const FIRST_POLL_MS = 500;
const POLL_MS = 1000;
const GIVE_UP_MS = 6 * 60 * 1000;
const POPOVER_WIDTH = 300;

// Os formatos, na ordem do menu Exportar do Power BI: Excel, PowerPoint e PDF (mais a imagem). O Excel sai das tabelas
// da página, direto do navegador; os demais são gerados pelo Power BI e precisam da permissão de exportar.
const FORMATS: { value: Format; label: string; title: string; needsFile: boolean }[] = [
  { value: "xlsx", label: "Excel", title: "Exportar para o Excel", needsFile: false },
  { value: "PPTX", label: "PowerPoint", title: "Exportar para o PowerPoint", needsFile: true },
  { value: "PDF", label: "PDF", title: "Exportar para PDF", needsFile: true },
  { value: "PNG", label: "Imagem (PNG)", title: "Exportar como imagem", needsFile: true },
];

const FILE_EXTENSION: Record<deliveryApi.DownloadFormat, string> = { PDF: "pdf", PNG: "png", PPTX: "pptx" };

/** Gera o arquivo no Power BI e baixa. Roda em segundo plano (ver `startExportJob`), sem depender da janela aberta. */
async function runFileExport(opts: {
  workspaceId: number;
  reportId: number;
  embed: ReportEmbedHandle | null;
  format: deliveryApi.DownloadFormat;
  /** Nomes tecnicos das paginas escolhidas; null = o relatorio inteiro */
  pageNames: string[] | null;
  valuesMode: ValuesMode;
  update: ProgressUpdate;
}) {
  const { workspaceId, reportId, embed, format, pageNames, update } = opts;
  update({ message: "Preparando a exportação..." });
  // "Valores atuais": o estado do relatório aberto (filtros e seleções); se não der para capturar, sai o padrão
  const bookmarkState = opts.valuesMode === "current" ? ((await embed?.captureBookmarkState?.()) ?? null) : null;
  update({ message: "Pedindo a exportação ao Power BI..." });
  const jobId = await deliveryApi.startReportDownload(workspaceId, reportId, format, pageNames, bookmarkState);
  const startedAt = Date.now();
  let first = true;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, first ? FIRST_POLL_MS : POLL_MS));
    first = false;
    let status: deliveryApi.DeliveryStatus | null = null;
    try {
      status = await deliveryApi.getDeliveryStatus(workspaceId, jobId);
    } catch {
      // Falha pontual de rede: tenta de novo no próximo ciclo
    }
    if (status) {
      update({ message: status.message || "Exportando...", progress: status.progress || null });
      if (status.status === "error") throw new Error(status.message || "Nao foi possivel exportar o relatorio.");
      if (status.status === "done") {
        update({ message: "Baixando o arquivo...", progress: 100 });
        await deliveryApi.downloadExportedFile(workspaceId, jobId, status.file_name || `relatorio.${FILE_EXTENSION[format]}`);
        return;
      }
    }
    if (Date.now() - startedAt > GIVE_UP_MS) throw new Error("A exportacao demorou demais. Tente de novo em instantes.");
  }
}

/** O botão Exportar do topo do relatório, no estilo do Power BI. Abre uma lista de formatos com o logo de cada um
 * (Excel, PowerPoint, PDF e imagem); ao escolher, abre a janela do formato. Ao clicar em Exportar a janela fecha na
 * hora e a exportação segue em segundo plano, com um aviso animado no canto da tela. Excel exporta as tabelas da
 * página direto do navegador (uma ou várias, à escolha). PowerPoint, PDF e imagem são gerados pelo Power BI, com os
 * valores atuais ou padrão do relatório, para as páginas escolhidas na lista (todas por padrão). */
export default function ExportMenu({
  embedRef,
  workspaceId,
  reportId,
  canExportFile,
}: {
  embedRef: RefObject<ReportEmbedHandle | null>;
  workspaceId: number;
  reportId: number;
  /** Pode gerar PowerPoint, PDF e imagem (permissão de exportar na coleção). Sem isso, só o Excel das tabelas. */
  canExportFile: boolean;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [format, setFormat] = useState<Format | null>(null);
  const [valuesMode, setValuesMode] = useState<ValuesMode>("current");
  const [tables, setTables] = useState<TableVisualInfo[] | null>(null);
  const [pages, setPages] = useState<ReportPageInfo[] | null>(null);
  // Como nas listas da Auditoria: nada marcado = tudo (o padrao), e a escolha vale mesmo se a lista chegar depois
  const [tablesSelected, setTablesSelected] = useState<string[]>([]);
  const [pagesSelected, setPagesSelected] = useState<string[]>([]);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const exporting = useExportJobs().some((job) => job.state === "running");

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const closeList = useCallback(() => setListOpen(false), []);
  const closeDialog = useCallback(() => setFormat(null), []);

  function toggle() {
    if (listOpen) return closeList();
    if (format) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPosition({ position: "fixed", top: rect.bottom + 8, left, width: POPOVER_WIDTH });
    }
    setListOpen(true);
    // As tabelas e as páginas costumam estar lidas desde que a página desenhou: ficam prontas na hora. Só se ainda não
    // terminaram de carregar é que a leitura é pedida agora.
    const embed = embedRef.current;
    const readyTables = embed?.peekTableVisuals?.() ?? null;
    setTables(readyTables);
    if (!readyTables) {
      embed
        ?.getTableVisuals()
        .then((list) => !cancelledRef.current && setTables(list))
        .catch(() => !cancelledRef.current && setTables([]));
      if (!embed) setTables([]);
    }
    const readyPages = embed?.peekPages?.() ?? null;
    setPages(readyPages);
    if (!readyPages) {
      // Sem a lista de páginas, a janela não mostra a escolha e exporta o relatório inteiro
      embed
        ?.getReportPages?.()
        .then((list) => !cancelledRef.current && setPages(list))
        .catch(() => !cancelledRef.current && setPages([]));
      if (!embed?.getReportPages) setPages([]);
    }
  }

  function chooseFormat(next: Format) {
    setListOpen(false);
    setTablesSelected([]);
    setPagesSelected([]);
    setValuesMode("current");
    setFormat(next);
  }

  // A lista fecha com Esc ou clique fora
  useEffect(() => {
    if (!listOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeList();
    }
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeList();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [listOpen, closeList]);

  // A janela fecha com Esc. Com uma lista suspensa (paginas, tabelas) aberta, o Esc fecha so a lista.
  useEffect(() => {
    if (!format) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector(".multiselect-panel")) closeDialog();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [format, closeDialog]);

  // Fecha a janela na hora e entrega o trabalho ao segundo plano: o aviso animado mostra o andamento e o arquivo
  // baixa sozinho, mesmo que a pessoa continue usando o relatório (ou saia dele).
  function handleExport() {
    if (!format) return;
    const embed = embedRef.current;
    const chosen = format;
    const label = FORMATS.find((f) => f.value === chosen)?.label ?? "arquivo";
    // Nada marcado (ou tudo marcado) = sem filtro: o relatorio inteiro e todas as tabelas. So manda os nomes quando
    // e um pedaco, na ordem em que aparecem na lista (a ordem das paginas do relatorio).
    const chosenTables = tableOptions.map((o) => o.value).filter((v) => tablesSelected.includes(v));
    const chosenPages = pageOptions.map((o) => o.value).filter((v) => pagesSelected.includes(v));
    const tableName =
      tables?.length === 1
        ? tables[0].name
        : chosenTables.length > 0 && chosenTables.length < tableOptions.length
          ? chosenTables
          : undefined;
    const pageNames = chosenPages.length > 0 && chosenPages.length < pageOptions.length ? chosenPages : null;
    closeDialog();
    startExportJob(label, async (update) => {
      if (chosen === "xlsx") {
        update({ message: "Gerando a planilha..." });
        await embed?.exportTableData(tableName, "xlsx");
        return;
      }
      await runFileExport({ workspaceId, reportId, embed, valuesMode, pageNames, format: chosen, update });
    });
  }

  const tableOptions = (tables ?? []).map((t) => ({ value: t.name, label: t.title || t.name }));
  const pageOptions = (pages ?? []).map((p) => ({ value: p.name, label: p.displayName || p.name }));
  const visibleFormats = FORMATS.filter((f) => !f.needsFile || canExportFile);
  const current = FORMATS.find((f) => f.value === format) ?? null;
  const isTables = format === "xlsx";
  const noTables = isTables && tables !== null && tables.length === 0;
  const loadingTables = isTables && tables === null;
  const choosingTables = isTables && tableOptions.length > 1;
  const choosingPages = !isTables && pageOptions.length > 1;
  const loadingPages = !isTables && pages === null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="fullscreen-action"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={listOpen}
        title="Exportar dados ou o relatório"
      >
        {exporting ? (
          <span className="export-spinner" aria-hidden="true" />
        ) : (
          <span className="material-symbols-outlined" aria-hidden="true">
            download
          </span>
        )}
        <span>{exporting ? "Exportando..." : "Exportar"}</span>
      </button>
      <ExportJobsTray />

      {listOpen &&
        createPortal(
          <div ref={listRef} className="export-menu" style={position} role="menu" aria-label="Exportar">
            {visibleFormats.map((f) => (
              <button key={f.value} type="button" role="menuitem" className="export-format-item" onClick={() => chooseFormat(f.value)}>
                <ExportFormatIcon kind={f.value} />
                {f.label}
              </button>
            ))}
          </div>,
          document.body,
        )}

      {current &&
        createPortal(
          <div
            className="export-dialog-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDialog();
            }}
          >
            <div className="export-dialog" role="dialog" aria-label={current.title}>
              <div className="export-dialog-header">
                {current.value !== "PDF" && <ExportFormatIcon kind={current.value} />}
                <h2 className="export-dialog-title">{current.title}</h2>
                <button type="button" className="export-dialog-close" onClick={closeDialog} aria-label="Fechar">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    close
                  </span>
                </button>
              </div>

              {isTables && (
                <>
                  {choosingTables && (
                    <div className="export-dialog-field">
                      <MultiSelect
                        label="Tabelas"
                        options={tableOptions}
                        selected={tablesSelected}
                        onChange={setTablesSelected}
                        emptyLabel={`Todas as tabelas (${tableOptions.length})`}
                      />
                    </div>
                  )}
                  {tables !== null && tables.length === 1 && (
                    <p className="export-dialog-note">Será exportada a tabela da página: {tables[0].title || tables[0].name}.</p>
                  )}
                  {choosingTables && <p className="export-dialog-note">Cada tabela vira uma aba da planilha.</p>}
                  {loadingTables && <p className="export-dialog-note">Procurando tabelas na página...</p>}
                  {noTables && <p className="export-dialog-note">Nenhuma tabela encontrada na página atual.</p>}
                </>
              )}

              {!isTables && (
                <>
                  {current.value === "PPTX" && (
                    <p className="export-dialog-note">Cada página do relatório vira um slide, com a imagem da página.</p>
                  )}
                  <label className="export-dialog-field">
                    Exportar com:
                    <select className="input" value={valuesMode} onChange={(e) => setValuesMode(e.target.value as ValuesMode)}>
                      <option value="current">Valores Atuais</option>
                      <option value="default">Valores Padrão</option>
                    </select>
                  </label>
                  {choosingPages && (
                    <div className="export-dialog-field">
                      <MultiSelect
                        label="Páginas"
                        options={pageOptions}
                        selected={pagesSelected}
                        onChange={setPagesSelected}
                        emptyLabel={`Todas as páginas (${pageOptions.length})`}
                      />
                    </div>
                  )}
                  {loadingPages && <p className="export-dialog-note">Carregando as páginas do relatório...</p>}
                </>
              )}

              <div className="export-dialog-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={handleExport} disabled={loadingTables || noTables || loadingPages}>
                  Exportar
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={closeDialog}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
