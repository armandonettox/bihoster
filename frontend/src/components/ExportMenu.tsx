import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { extractErrorMessage } from "../api/client";
import * as deliveryApi from "../api/reportDelivery";
import type { ReportEmbedHandle, TableExportFormat, TableVisualInfo } from "./ReportEmbed";

type Scope = "tables" | "page" | "report";
type Format = TableExportFormat | deliveryApi.DownloadFormat;

const POLL_MS = 2000;
const GIVE_UP_MS = 6 * 60 * 1000;
const POPOVER_WIDTH = 340;

const SCOPES: { value: Scope; label: string; hint: string; needsFile: boolean }[] = [
  { value: "tables", label: "Tabelas da página", hint: "Os dados das tabelas desta página.", needsFile: false },
  { value: "page", label: "Página atual", hint: "A página aberta, como aparece na tela.", needsFile: true },
  { value: "report", label: "Relatório inteiro", hint: "Todas as páginas do relatório.", needsFile: true },
];

const FORMATS: Record<Scope, { value: Format; label: string; hint: string }[]> = {
  tables: [
    { value: "csv", label: "CSV", hint: "Texto separado por vírgulas" },
    { value: "xlsx", label: "Excel (.xlsx)", hint: "Planilha, uma aba por tabela" },
  ],
  page: [
    { value: "PDF", label: "PDF", hint: "Documento para ler e imprimir" },
    { value: "PNG", label: "Imagem (PNG)", hint: "Foto da página" },
  ],
  report: [
    { value: "PDF", label: "PDF", hint: "Documento para ler e imprimir" },
    { value: "PNG", label: "Imagem (PNG)", hint: "Uma imagem por página, em um zip" },
  ],
};

/** O botão Exportar do topo do relatório: abre uma janela suspensa para escolher o que exportar (tabelas da página,
 * página atual ou relatório inteiro) e como (CSV ou Excel para tabelas; PDF ou imagem para página e relatório). Tabelas
 * saem direto do navegador; PDF e imagem são gerados pelo Power BI, o que leva alguns segundos. */
export default function ExportMenu({
  embedRef,
  workspaceId,
  reportId,
  canExportFile,
}: {
  embedRef: RefObject<ReportEmbedHandle | null>;
  workspaceId: number;
  reportId: number;
  /** Pode gerar PDF e imagem (permissão de exportar na coleção). Sem isso, só as tabelas. */
  canExportFile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("tables");
  const [format, setFormat] = useState<Format>("csv");
  const [tables, setTables] = useState<TableVisualInfo[] | null>(null);
  const [tableChoice, setTableChoice] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMessage(null);
    setError(null);
  }, []);

  function toggle() {
    if (open) return busy ? undefined : close();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
      setPosition({ position: "fixed", top: rect.bottom + 8, left, width: POPOVER_WIDTH });
    }
    setError(null);
    setMessage(null);
    setTables(null);
    setTableChoice("all");
    setScope("tables");
    setFormat("csv");
    setOpen(true);
    embedRef.current
      ?.getTableVisuals()
      .then((list) => {
        if (cancelledRef.current) return;
        setTables(list);
        // Página sem tabelas: o que sobra para exportar é a própria página
        if (list.length === 0 && canExportFile) {
          setScope("page");
          setFormat("PDF");
        }
      })
      .catch(() => !cancelledRef.current && setTables([]));
    if (!embedRef.current) setTables([]);
  }

  // Fecha com Esc ou clique fora, menos enquanto exporta (para não perder o andamento de vista)
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) close();
    }
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (busy || panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, busy, close]);

  function chooseScope(next: Scope) {
    setScope(next);
    setFormat(FORMATS[next][0].value);
    setError(null);
  }

  async function exportFile(downloadFormat: deliveryApi.DownloadFormat) {
    let pageName: string | null = null;
    if (scope === "page") {
      pageName = (await embedRef.current?.getActivePageName()) ?? null;
      if (!pageName) throw new Error("Nao foi possivel identificar a pagina aberta. Aguarde o relatorio carregar.");
    }
    setMessage("Pedindo a exportação ao Power BI...");
    const jobId = await deliveryApi.startReportDownload(workspaceId, reportId, downloadFormat, pageName);
    const startedAt = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (cancelledRef.current) return;
      let status: deliveryApi.DeliveryStatus | null = null;
      try {
        status = await deliveryApi.getDeliveryStatus(workspaceId, jobId);
      } catch {
        // Falha pontual de rede: tenta de novo no próximo ciclo
      }
      if (status) {
        setMessage(status.message || "Exportando...");
        if (status.status === "error") throw new Error(status.message || "Nao foi possivel exportar o relatorio.");
        if (status.status === "done") {
          setMessage("Baixando o arquivo...");
          await deliveryApi.downloadExportedFile(workspaceId, jobId, status.file_name || `relatorio.${downloadFormat === "PDF" ? "pdf" : "png"}`);
          return;
        }
      }
      if (Date.now() - startedAt > GIVE_UP_MS) throw new Error("A exportacao demorou demais. Tente de novo em instantes.");
    }
  }

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      if (scope === "tables") {
        const name = tableChoice === "all" ? (tables?.length === 1 ? tables[0].name : undefined) : tableChoice;
        await embedRef.current?.exportTableData(name, format as TableExportFormat);
      } else {
        await exportFile(format as deliveryApi.DownloadFormat);
      }
      if (!cancelledRef.current) close();
    } catch (err) {
      if (!cancelledRef.current) {
        setMessage(null);
        // Recusa do servidor (ex.: RLS) traz o motivo em response.data.detail; erro nosso traz a propria mensagem
        setError(extractErrorMessage(err) || (err instanceof Error && err.message) || "Nao foi possivel exportar.");
      }
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  const noTables = scope === "tables" && tables !== null && tables.length === 0;
  const loadingTables = scope === "tables" && tables === null;
  const visibleScopes = SCOPES.filter((s) => !s.needsFile || canExportFile);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="fullscreen-action"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Exportar dados ou o relatório"
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          download
        </span>
        <span>Exportar</span>
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} className="export-menu" style={position} role="dialog" aria-label="Exportar">
            <p className="export-menu-title">Exportar</p>

            <fieldset className="export-menu-group" disabled={busy}>
              <legend>O que exportar</legend>
              {visibleScopes.map((s) => (
                <label key={s.value} className="export-menu-option">
                  <input type="radio" name="export-scope" checked={scope === s.value} onChange={() => chooseScope(s.value)} />
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {scope === "tables" && tables !== null && tables.length > 1 && (
              <label className="export-menu-field">
                Qual tabela
                <select className="input" value={tableChoice} onChange={(e) => setTableChoice(e.target.value)} disabled={busy}>
                  <option value="all">Todas as tabelas ({tables.length})</option>
                  {tables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.title || t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {loadingTables && <p className="export-menu-note">Procurando tabelas na página...</p>}
            {noTables && <p className="export-menu-note">Nenhuma tabela encontrada na página atual.</p>}

            <fieldset className="export-menu-group" disabled={busy}>
              <legend>Como exportar</legend>
              {FORMATS[scope].map((f) => (
                <label key={f.value} className="export-menu-option">
                  <input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} />
                  <span>
                    <strong>{f.label}</strong>
                    <small>{f.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            {message && (
              <p className="export-menu-note" role="status">
                {message}
              </p>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <div className="export-menu-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={busy}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleExport}
                disabled={busy || loadingTables || noTables}
              >
                {busy ? "Exportando..." : "Exportar"}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
