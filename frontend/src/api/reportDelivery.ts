import { api } from "./client";

export type ExportFormat = "PDF" | "PNG" | "PPTX";

export interface DeliveryStatus {
  /** queued, exporting, sending, done ou error */
  status: string;
  message: string;
  progress: number;
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
