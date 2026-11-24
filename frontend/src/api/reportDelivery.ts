import { downloadBlob } from "../utils/download";
import { api } from "./client";

export type ExportFormat = "PDF" | "PNG" | "PPTX";

export interface DeliveryStatus {
  /** queued, exporting, sending, done ou error */
  status: string;
  message: string;
  progress: number;
  /** So na exportacao para baixar: o nome do arquivo pronto */
  file_name?: string | null;
}

/** Pede a exportacao do relatorio e o envio por e-mail, em segundo plano. Devolve o id do envio. */
export async function exportReportByEmail(
  workspaceId: number,
  reportId: number,
  to: string,
  format: ExportFormat,
): Promise<string> {
  const { data } = await api.post(`/workspaces/${workspaceId}/powerbi/reports/${reportId}/export-email`, { to, format });
  return data.job_id;
}

export async function getDeliveryStatus(workspaceId: number, jobId: string): Promise<DeliveryStatus> {
  const { data } = await api.get(`/workspaces/${workspaceId}/powerbi/export-jobs/${jobId}`);
  return data;
}

export type DownloadFormat = "PDF" | "PNG" | "PPTX";

/** Pede a exportacao do relatorio (ou de algumas paginas) para baixar, em segundo plano. Sem `pageNames`, exporta o
 * relatorio inteiro. Devolve o id do trabalho; o andamento sai em `getDeliveryStatus` e o arquivo em `downloadExportedFile`. */
export async function startReportDownload(
  workspaceId: number,
  reportId: number,
  format: DownloadFormat,
  pageNames?: string[] | null,
  /** Estado capturado do relatorio aberto (filtros e selecoes atuais); sem ele, sai com os valores padrao */
  bookmarkState?: string | null,
): Promise<string> {
  const { data } = await api.post(`/workspaces/${workspaceId}/powerbi/reports/${reportId}/export-download`, {
    format,
    page_names: pageNames ?? null,
    bookmark_state: bookmarkState ?? null,
  });
  return data.job_id;
}

/** Baixa o arquivo da exportacao pronta (o servidor entrega uma vez so). */
export async function downloadExportedFile(workspaceId: number, jobId: string, fileName: string): Promise<void> {
  const { data } = await api.get(`/workspaces/${workspaceId}/powerbi/export-jobs/${jobId}/file`, { responseType: "blob" });
  downloadBlob(data as Blob, fileName);
}
