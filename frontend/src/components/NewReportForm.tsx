import { useEffect, useState, type FormEvent } from "react";
import * as reportsApi from "../api/reports";
import type { DisplayType, Report } from "../api/reports";
import * as powerbiApi from "../api/powerbi";
import type { PowerBIWorkspace, PowerBIReportSummary } from "../api/powerbi";
import * as powerbiConnectionsApi from "../api/powerbiConnections";
import type { PowerBIConnection } from "../api/powerbiConnections";
import { useWorkspace } from "../context/WorkspaceContext";
import { extractErrorMessage } from "../api/client";
import Modal from "./Modal";

const DISPLAY_TYPE_OPTIONS: { key: DisplayType; label: string; hint: string }[] = [
  { key: "relatorio", label: "Relatorio", hint: "Aparece na lista, um relatorio expandido por vez." },
  { key: "painel", label: "Painel", hint: "Aparece numa grade, junto com os outros do painel." },
  { key: "apresentacao", label: "Apresentacao", hint: "Navegacao manual entre os relatorios da apresentacao." },
  { key: "tv", label: "Modo TV", hint: "Pode entrar numa playlist de TV que reveza em tela cheia." },
];

export default function NewReportForm({
  editingReport,
  onCreated,
  onClose,
}: {
  editingReport?: Report | null;
  onCreated: () => void;
  onClose: () => void;
}) {
  const { currentWorkspace } = useWorkspace();
  const [name, setName] = useState(editingReport?.name || "");
  const [connections, setConnections] = useState<PowerBIConnection[]>([]);
  const [connectionId, setConnectionId] = useState<number | "">(editingReport?.powerbi_connection_id || "");
  const [pbiWorkspaces, setPbiWorkspaces] = useState<PowerBIWorkspace[]>([]);
  const [pbiWorkspaceId, setPbiWorkspaceId] = useState(editingReport?.pbi_workspace_id || "");
  const [pbiReports, setPbiReports] = useState<PowerBIReportSummary[]>([]);
  const [pbiReportId, setPbiReportId] = useState(editingReport?.pbi_report_id || "");
  const [datasetId, setDatasetId] = useState(editingReport?.pbi_dataset_id || "");
  const [displayType, setDisplayType] = useState<DisplayType>(editingReport?.display_type || "relatorio");
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    powerbiConnectionsApi
      .listConnections()
      .then(setConnections)
      .catch((err) => {
        setCatalogError(
          extractErrorMessage(err) ||
            "Nao foi possivel listar as contas do Power BI. Peca a um administrador para configurar em Configuracoes > Geral."
        );
      })
      .finally(() => setLoadingConnections(false));
  }, []);

  useEffect(() => {
    if (!connectionId) {
      setPbiWorkspaces([]);
      return;
    }
    let cancelled = false;
    setLoadingWorkspaces(true);
    powerbiApi
      .listPowerBIWorkspaces(connectionId)
      .then((data) => {
        // Ignora resposta de uma conta antiga que chegou depois de trocarmos pra outra --
        // sem isso o dropdown podia mostrar workspaces da conta errada.
        if (!cancelled) setPbiWorkspaces(data);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(extractErrorMessage(err) || "Nao foi possivel conectar a essa conta do Power BI.");
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspaces(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !pbiWorkspaceId) {
      setPbiReports([]);
      return;
    }
    let cancelled = false;
    setLoadingReports(true);
    powerbiApi
      .listPowerBIReports(connectionId, pbiWorkspaceId)
      .then((data) => {
        if (!cancelled) setPbiReports(data);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(extractErrorMessage(err) || "Nao foi possivel listar os relatorios.");
      })
      .finally(() => {
        if (!cancelled) setLoadingReports(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, pbiWorkspaceId]);

  function handleSelectReport(reportId: string) {
    setPbiReportId(reportId);
    const report = pbiReports.find((r) => r.id === reportId);
    setDatasetId(report?.dataset_id || "");
    if (!name) setName(report?.name || "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!currentWorkspace || !connectionId) return;
    setError(null);
    setLoading(true);
    try {
      const input = {
        name,
        powerbi_connection_id: connectionId,
        pbi_workspace_id: pbiWorkspaceId,
        pbi_report_id: pbiReportId,
        pbi_dataset_id: datasetId || null,
        display_type: displayType,
      };
      if (editingReport) {
        await reportsApi.updateReport(currentWorkspace.id, editingReport.id, input);
      } else {
        await reportsApi.createReport(currentWorkspace.id, input);
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar o relatorio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={editingReport ? "Editar relatorio" : "Adicionar relatorio"} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {catalogError ? (
          <p className="auth-error">{catalogError}</p>
        ) : loadingConnections ? (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Carregando contas do Power BI...</p>
        ) : connections.length === 0 ? (
          <p className="auth-error">
            Nenhuma conta do Power BI configurada. Peca a um administrador para adicionar uma em
            Configuracoes {`>`} Geral.
          </p>
        ) : (
          <>
            <label className="field">
              Conta do Power BI
              <select
                className="input"
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value ? Number(e.target.value) : "");
                  setPbiWorkspaceId("");
                  setPbiReportId("");
                  setDatasetId("");
                }}
                required
              >
                <option value="">Selecione uma conta</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {connectionId && (
              <label className="field">
                Workspace do Power BI
                <select
                  className="input"
                  value={pbiWorkspaceId}
                  onChange={(e) => {
                    setPbiWorkspaceId(e.target.value);
                    setPbiReportId("");
                    setDatasetId("");
                  }}
                  disabled={loadingWorkspaces}
                  required
                >
                  <option value="">{loadingWorkspaces ? "Carregando..." : "Selecione um workspace"}</option>
                  {pbiWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {pbiWorkspaceId && (
              <label className="field">
                Relatorio publicado
                <select
                  className="input"
                  value={pbiReportId}
                  onChange={(e) => handleSelectReport(e.target.value)}
                  disabled={loadingReports}
                  required
                >
                  <option value="">{loadingReports ? "Carregando..." : "Selecione um relatorio"}</option>
                  {pbiReports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {!loadingReports && pbiReports.length === 0 && (
                  <span style={{ fontWeight: 400, fontSize: 12 }}>Nenhum relatorio publicado nesse workspace.</span>
                )}
              </label>
            )}
          </>
        )}

        <label className="field">
          Nome na colecao
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="field">
          Onde exibir nesta colecao
          <select className="input" value={displayType} onChange={(e) => setDisplayType(e.target.value as DisplayType)}>
            {DISPLAY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <span style={{ fontWeight: 400, fontSize: 12 }}>
            {DISPLAY_TYPE_OPTIONS.find((opt) => opt.key === displayType)?.hint}
          </span>
        </label>

        {error && <p className="auth-error">{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading || !!catalogError}>
            {loading ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
