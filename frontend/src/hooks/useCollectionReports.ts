import { useCallback, useEffect, useRef, useState } from "react";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";

// Relatorios da colecao aberta: carga, exclusao, reordenacao e qual esta expandido na lista.
// Recebe so o id da colecao (nao o objeto): o reload do WorkspaceContext cria um objeto novo a
// cada chamada, e depender dele resetava a pagina inteira.
export function useCollectionReports(workspaceId: number | undefined) {
  const { showToast } = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReportId, setActiveReportId] = useState<number | null>(null);
  const [movingReportId, setMovingReportId] = useState<number | null>(null);

  const loadRequestIdRef = useRef(0);
  const loadReports = useCallback(async () => {
    if (workspaceId === undefined) return;
    const requestId = ++loadRequestIdRef.current;
    const data = await reportsApi.listReports(workspaceId);
    // Ignora respostas de uma colecao/pedido antigo que chegaram depois de um mais recente --
    // evita mostrar os relatorios da colecao errada ao trocar de colecao rapidamente.
    if (requestId !== loadRequestIdRef.current) return;
    setReports(data);
  }, [workspaceId]);

  // Recarrega a lista apos criar/editar/excluir; se falhar, avisa em vez de deixar a promise
  // sem tratamento (rejeicao nao capturada) com a lista velha na tela.
  const refreshReports = useCallback(async () => {
    try {
      await loadReports();
    } catch {
      showToast("Nao foi possivel atualizar a lista de relatorios.", "error");
    }
  }, [loadReports, showToast]);

  useEffect(() => {
    setLoading(true);
    setActiveReportId(null);
    loadReports()
      .catch(() => showToast("Nao foi possivel carregar os relatorios desta colecao.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReports]);

  function toggleActiveReport(reportId: number) {
    setActiveReportId((current) => (current === reportId ? null : reportId));
  }

  async function deleteReport(reportId: number) {
    if (workspaceId === undefined) return;
    try {
      await reportsApi.deleteReport(workspaceId, reportId);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel excluir o relatorio.", "error");
      return;
    }
    if (activeReportId === reportId) setActiveReportId(null);
    // O servidor ja confirmou: tira da lista na hora, sem esperar uma segunda ida a rede, e
    // recarrega em segundo plano so pra alinhar com o servidor.
    setReports((current) => current.filter((r) => r.id !== reportId));
    showToast("Relatorio excluido.");
    refreshReports();
  }

  // Sobe/desce um relatorio dentro da secao. O servidor devolve a lista ja reordenada, entao a
  // tela usa essa resposta em vez de adivinhar a nova ordem; enquanto isso os botoes ficam
  // bloqueados pra um clique duplo nao mandar dois movimentos seguidos.
  async function moveReport(report: Report, direction: "up" | "down") {
    if (workspaceId === undefined || movingReportId !== null) return;
    setMovingReportId(report.id);
    try {
      setReports(await reportsApi.moveReport(workspaceId, report.id, direction));
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel mudar a ordem do relatorio.", "error");
    } finally {
      setMovingReportId(null);
    }
  }

  return {
    reports,
    loading,
    refreshReports,
    activeReportId,
    toggleActiveReport,
    deleteReport,
    movingReportId,
    moveReport,
  };
}
