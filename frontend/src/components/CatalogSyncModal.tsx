import { useCallback, useEffect, useRef, useState } from "react";
import { extractErrorMessage } from "../api/client";
import * as connectionsApi from "../api/powerbiConnections";
import type { PowerBIConnection, SyncStatus, TenantWorkspace } from "../api/powerbiConnections";
import { useToast } from "../context/ToastContext";
import { formatDateTime } from "../utils/datetime";
import Modal from "./Modal";

const POLL_MS = 1500;

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Só quando eu clicar em Sincronizar" },
  { value: "1", label: "A cada hora" },
  { value: "6", label: "A cada 6 horas" },
  { value: "12", label: "A cada 12 horas" },
  { value: "24", label: "Todos os dias" },
  { value: "168", label: "Toda semana" },
];

function resultText(status: SyncStatus["last_sync"]): string {
  if (!status) return "Esta conta ainda não foi sincronizada.";
  const parts = [
    `${status.reports_new ?? 0} relatórios novos`,
    `${status.reports_updated ?? 0} atualizados`,
    `${status.reports_missing ?? 0} não encontrados`,
  ];
  const models = `${status.datasets_new ?? 0} modelos novos`;
  return `${parts.join(", ")}; ${models}.`;
}

/** Janela do botao Sincronizar de uma conta: escolhe quais workspaces importar e a agenda, e roda a sincronizacao
 * acompanhando o andamento. Tudo o que e importado vai para a Raiz, que so administradores veem. */
export default function CatalogSyncModal({
  connection,
  onClose,
  onFinished,
}: {
  connection: PowerBIConnection;
  onClose: () => void;
  onFinished?: () => void;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<TenantWorkspace[]>([]);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [interval, setIntervalValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const applyStatus = useCallback((next: SyncStatus) => {
    setStatus(next);
    setOnlyChosen(next.workspace_ids.length > 0);
    setChosen(new Set(next.workspace_ids));
    setIntervalValue(next.interval_hours ? String(next.interval_hours) : "");
  }, []);

  const follow = useCallback(
    (jobId: string) => {
      setRunning(true);
      const tick = async () => {
        try {
          const job = await connectionsApi.getSyncJob(connection.id, jobId);
          if (!alive.current) return;
          setProgress(job.progress);
          setMessage(job.message);
          if (job.status === "done" || job.status === "error") {
            setRunning(false);
            const fresh = await connectionsApi.getSyncStatus(connection.id);
            if (!alive.current) return;
            setStatus(fresh);
            if (job.status === "error") setError(job.message);
            else showToast("Catálogo sincronizado.");
            onFinished?.();
            return;
          }
          timer.current = setTimeout(tick, POLL_MS);
        } catch (err) {
          if (!alive.current) return;
          setRunning(false);
          setError(extractErrorMessage(err) || "Não foi possível acompanhar a sincronização.");
        }
      };
      void tick();
    },
    [connection.id, onFinished, showToast],
  );

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const current = await connectionsApi.getSyncStatus(connection.id);
        if (!alive.current) return;
        applyStatus(current);
        if (current.running_job_id) follow(current.running_job_id);
      } catch (err) {
        if (alive.current) setError(extractErrorMessage(err) || "Não foi possível ler o estado da sincronização.");
      } finally {
        if (alive.current) setLoading(false);
      }
      try {
        const list = await connectionsApi.listTenantWorkspaces(connection.id);
        if (alive.current) setWorkspaces(list);
      } catch (err) {
        if (alive.current) setWorkspacesError(extractErrorMessage(err) || "Não foi possível listar os workspaces do tenant.");
      }
    })();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [connection.id, applyStatus, follow]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveSettings(): Promise<boolean> {
    const ids = onlyChosen ? Array.from(chosen) : [];
    if (onlyChosen && ids.length === 0) {
      setError("Escolha ao menos um workspace, ou volte para Todos os workspaces.");
      return false;
    }
    try {
      const saved = await connectionsApi.updateSyncSettings(connection.id, {
        workspace_ids: ids,
        interval_hours: interval ? Number(interval) : null,
      });
      setStatus(saved);
      return true;
    } catch (err) {
      setError(extractErrorMessage(err) || "Não foi possível salvar as escolhas.");
      return false;
    }
  }

  async function handleSave() {
    setError(null);
    if (await saveSettings()) showToast("Escolhas da sincronização salvas.");
  }

  async function handleSync() {
    setError(null);
    if (!(await saveSettings())) return;
    try {
      const jobId = await connectionsApi.startSync(connection.id);
      setProgress(0);
      setMessage("Na fila.");
      follow(jobId);
    } catch (err) {
      setError(extractErrorMessage(err) || "Não foi possível iniciar a sincronização.");
    }
  }

  const last = status?.last_sync ?? null;

  return (
    <Modal title={`Sincronizar ${connection.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Traz para o portal os relatórios e modelos publicados no tenant. Tudo entra na Raiz, que só administradores
          veem: ninguém ganha acesso a um relatório importado até você dar a permissão.
        </p>

        <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }} disabled={running || loading}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Quais workspaces importar</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="sync-scope" checked={!onlyChosen} onChange={() => setOnlyChosen(false)} />
            Todos os workspaces do tenant
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="sync-scope" checked={onlyChosen} onChange={() => setOnlyChosen(true)} />
            Só os que eu escolher
          </label>
          {onlyChosen && (
            <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
              {workspacesError && <span className="auth-error">{workspacesError}</span>}
              {workspaces.map((workspace) => (
                <label key={workspace.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={chosen.has(workspace.id)} onChange={() => toggle(workspace.id)} />
                  {workspace.name}
                </label>
              ))}
              {!workspacesError && workspaces.length === 0 && (
                <span style={{ color: "var(--color-text-muted)" }}>Nenhum workspace visível para esta conta.</span>
              )}
            </div>
          )}
        </fieldset>

        <label className="field">
          Sincronização automática
          <select className="input" value={interval} onChange={(e) => setIntervalValue(e.target.value)} disabled={running || loading}>
            {INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="card" style={{ padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>Última sincronização</div>
          {status?.next_run_at && <div className="rpt-muted">Próxima automática: {formatDateTime(status.next_run_at)}</div>}
          {last ? (
            <>
              <div>
                {last.finished_at ? formatDateTime(last.finished_at) : "em andamento"}
                {last.started_by_scheduler ? " (agendada)" : ""}
              </div>
              <div>{resultText(last)}</div>
              {last.error && <div className="auth-error">{last.error}</div>}
            </>
          ) : (
            <div>{resultText(null)}</div>
          )}
        </div>

        {running && (
          <div role="status" aria-live="polite">
            <div style={{ height: 6, background: "var(--color-border)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "var(--color-primary)" }} />
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{message}</div>
          </div>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleSync} disabled={running || loading}>
            {running ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleSave} disabled={running || loading}>
            Salvar escolhas
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}
