import { useEffect, useState, type FormEvent } from "react";
import * as powerbiConnectionsApi from "../api/powerbiConnections";
import type { PowerBIConnection } from "../api/powerbiConnections";
import * as powerbiApi from "../api/powerbi";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../api/client";
import KebabMenu from "./KebabMenu";
import Modal from "./Modal";
import ConfirmDialog from "./ConfirmDialog";
import { SkeletonList } from "./Skeleton";

function ConnectionForm({
  connection,
  onSaved,
  onClose,
}: {
  connection?: PowerBIConnection | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(connection?.name || "");
  const [tenantId, setTenantId] = useState(connection?.tenant_id || "");
  const [clientId, setClientId] = useState(connection?.client_id || "");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const input = {
        name,
        tenant_id: tenantId,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      };
      if (connection) {
        await powerbiConnectionsApi.updateConnection(connection.id, input);
        showToast("Conta do Power BI atualizada.");
      } else {
        await powerbiConnectionsApi.createConnection({ ...input, client_secret: clientSecret });
        showToast("Conta do Power BI adicionada.");
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar a conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={connection ? "Editar conta do Power BI" : "Nova conta do Power BI"} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="field">
          Nome da conta
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Empresa Principal"
            required
            autoFocus
          />
        </label>
        <label className="field">
          Tenant ID
          <input
            className="input"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </label>
        <label className="field">
          Client ID
          <input
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </label>
        <label className="field">
          Client secret
          <input
            className="input"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={connection?.client_secret_configured ? "Ja configurado -- deixe em branco para manter" : ""}
            required={!connection}
          />
          <span style={{ fontWeight: 400, fontSize: 12 }}>
            Nunca e exibido depois de salvo. Deixe em branco para manter o atual.
          </span>
        </label>

        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
          No Azure AD, crie um app registration, gere um client secret e adicione essa service
          principal como membro (com permissao de Viewer) em cada workspace do Power BI que ela deve
          enxergar.
        </p>

        {error && <p className="auth-error">{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PowerBiConnectionsSection() {
  const [connections, setConnections] = useState<PowerBIConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingConnection, setEditingConnection] = useState<PowerBIConnection | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<PowerBIConnection | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const { showToast } = useToast();

  async function load() {
    setConnections(await powerbiConnectionsApi.listConnections());
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleDelete(connection: PowerBIConnection) {
    try {
      await powerbiConnectionsApi.deleteConnection(connection.id);
      await load();
      showToast("Conta removida.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover a conta.", "error");
    }
  }

  async function handleTestConnection(connection: PowerBIConnection) {
    setTestingId(connection.id);
    try {
      const workspaces = await powerbiApi.listPowerBIWorkspaces(connection.id);
      showToast(
        workspaces.length > 0
          ? `Conexao funcionando -- ${workspaces.length} workspace(s) encontrado(s).`
          : "Conexao funcionando, mas a service principal nao enxerga nenhum workspace ainda."
      );
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel conectar ao Power BI.", "error");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="settings-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h2 className="settings-section-title">Contas do Power BI</h2>
          <p className="settings-section-desc">
            Conecte uma ou mais service principals do Azure AD. Ao adicionar um relatorio numa
            colecao, escolhe-se qual conta usar, depois o workspace e o relatorio publicado -- sem
            digitar IDs na mao.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)} style={{ whiteSpace: "nowrap" }}>
          + Nova conta
        </button>
      </div>

      {loading ? (
        <SkeletonList count={2} />
      ) : connections.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhuma conta do Power BI configurada ainda.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {connections.map((connection) => (
            <div key={connection.id} className="card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{connection.name}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  Tenant {connection.tenant_id} · Client {connection.client_id}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleTestConnection(connection)}
                  disabled={testingId === connection.id}
                >
                  {testingId === connection.id ? "Testando..." : "Testar conexao"}
                </button>
                <KebabMenu>
                  {(close) => (
                    <>
                      <button
                        className="kebab-menu-item"
                        onClick={() => {
                          close();
                          setEditingConnection(connection);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="kebab-menu-item kebab-menu-item-danger"
                        onClick={() => {
                          close();
                          setConfirmingDelete(connection);
                        }}
                      >
                        Excluir
                      </button>
                    </>
                  )}
                </KebabMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <ConnectionForm onSaved={load} onClose={() => setCreating(false)} />}
      {editingConnection && (
        <ConnectionForm connection={editingConnection} onSaved={load} onClose={() => setEditingConnection(null)} />
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="Excluir conta do Power BI"
          message={`Excluir a conta "${confirmingDelete.name}"? Relatorios que usam essa conta param de funcionar.`}
          confirmLabel="Excluir"
          onConfirm={() => {
            const connection = confirmingDelete;
            setConfirmingDelete(null);
            handleDelete(connection);
          }}
          onCancel={() => setConfirmingDelete(null)}
        />
      )}
    </div>
  );
}
