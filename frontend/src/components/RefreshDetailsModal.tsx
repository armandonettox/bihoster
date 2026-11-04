import { useEffect, useMemo, useState } from "react";
import * as reportsApi from "../api/reports";
import type { DisplayType, RefreshInfo, Report } from "../api/reports";
import { formatDateTime } from "../utils/datetime";
import { statusLabel } from "../utils/refreshStatus";
import Modal from "./Modal";
import { SkeletonList } from "./Skeleton";

const TYPE_LABELS: Record<DisplayType, string> = {
  relatorio: "Relatorio",
  painel: "Painel",
  apresentacao: "Apresentacao",
  tv: "Modo TV",
};

type SortKey = "name" | "type" | "status" | "last_refresh" | "next_refresh";
type SortDir = "asc" | "desc";

function sortValue(report: Report, info: RefreshInfo | undefined, key: SortKey): string | null {
  switch (key) {
    case "name":
      return report.name.toLowerCase();
    case "type":
      return TYPE_LABELS[report.display_type];
    case "status":
      return info?.last_status ? statusLabel(info.last_status) : null;
    case "last_refresh":
      return info?.last_refresh ?? null;
    case "next_refresh":
      return info?.next_refresh ?? null;
  }
}

function formatDate(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "-";
}

/** Tabela com a ultima e a proxima atualizacao, e o status da ultima tentativa, de cada relatorio
 * da colecao. Os dados so sao buscados quando a janela abre, entao a tela da colecao nao paga
 * esse custo. Linhas sem data (nunca atualizou, sem agendamento, sem dataset) vao sempre pro fim. */
export default function RefreshDetailsModal({
  reports,
  workspaceId,
  onClose,
}: {
  reports: Report[];
  workspaceId: number;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Record<string, RefreshInfo> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Mais antiga primeiro: o que esta desatualizado aparece no topo
  const [sortKey, setSortKey] = useState<SortKey>("last_refresh");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // O estado comeca em "carregando"; o "tentar de novo" volta pra ele antes de pedir outra vez.
  // A janela fecha ao trocar de colecao, entao o workspaceId nao muda com ela aberta.
  useEffect(() => {
    let cancelled = false;
    reportsApi
      .getCollectionRefreshInfo(workspaceId)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return reports
      .map((report) => ({ report, info: info?.[String(report.id)] }))
      .sort((a, b) => {
        const va = sortValue(a.report, a.info, sortKey);
        const vb = sortValue(b.report, b.info, sortKey);
        // Sem valor sempre no fim, qualquer que seja a direcao
        if (va === null && vb === null) return a.report.name.localeCompare(b.report.name);
        if (va === null) return 1;
        if (vb === null) return -1;
        const order = va < vb ? -1 : va > vb ? 1 : 0;
        return order !== 0 ? order * direction : a.report.name.localeCompare(b.report.name);
      });
  }, [reports, info, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function header(key: SortKey, label: string) {
    const active = key === sortKey;
    return (
      <th aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: 0, font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }}
          onClick={() => toggleSort(key)}
        >
          {label}
          {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
        </button>
      </th>
    );
  }

  return (
    <Modal title="Atualizacoes dos relatorios" onClose={onClose} wide>
      {error ? (
        <div>
          <p style={{ color: "var(--color-text-muted)" }}>Nao foi possivel carregar as informacoes de atualizacao.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setError(false);
              setAttempt((n) => n + 1);
            }}
          >
            Tentar de novo
          </button>
        </div>
      ) : reports.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhum relatorio nesta colecao ainda.</p>
      ) : info === null ? (
        <SkeletonList count={4} />
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  {header("name", "Relatorio")}
                  {header("type", "Tipo")}
                  {header("status", "Status")}
                  {header("last_refresh", "Ultima atualizacao")}
                  {header("next_refresh", "Proxima atualizacao")}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ report, info: rowInfo }) => (
                  <tr key={report.id}>
                    <td style={{ fontWeight: 600 }}>{report.name}</td>
                    <td>{TYPE_LABELS[report.display_type]}</td>
                    <td
                      style={rowInfo?.last_status === "Failed" ? { color: "var(--color-danger)", fontWeight: 600 } : undefined}
                    >
                      {statusLabel(rowInfo?.last_status)}
                    </td>
                    <td>{formatDate(rowInfo?.last_refresh)}</td>
                    <td>{formatDate(rowInfo?.next_refresh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 12, marginBottom: 0 }}>
            Dados do Power BI, com ate 5 minutos de atraso. Quando a ultima tentativa falhou, a data mostrada e a da
            ultima atualizacao concluida.
          </p>
        </>
      )}
    </Modal>
  );
}
