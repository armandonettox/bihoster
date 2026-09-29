import { useEffect, useState } from "react";
import * as auditApi from "../../api/audit";
import type { AuditLogEntry } from "../../api/audit";
import { SkeletonList } from "../../components/Skeleton";
import { useBranding } from "../../context/BrandingContext";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../utils/datetime";

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  login_blocked: "Login bloqueado",
  account_locked: "Conta bloqueada",
  register: "Cadastro",
  reset_password: "Senha redefinida",
  generate_reset_link: "Link de redefinicao gerado",
  delete_user: "Membro removido",
  update_auth_settings: "Configuracoes de autenticacao alteradas",
  create: "Criado",
  update: "Atualizado",
  delete: "Excluido",
  add_group_member: "Membro adicionado ao grupo",
  invite_group_member: "Convite de grupo criado",
  set_access: "Acesso de grupo alterado",
  view_page: "Pagina visualizada",
  apply_update: "Atualizacao do sistema aplicada",
};

export default function AuditTab() {
  const { settings } = useBranding();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    auditApi
      .listAuditLogs()
      .then(setLogs)
      .catch(() => showToast("Nao foi possivel carregar a auditoria.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = logs.filter((log) => {
    if (!filter) return true;
    const actionLabel = ACTION_LABELS[log.action] || log.action;
    const haystack = `${log.user_name || ""} ${log.user_email || ""} ${actionLabel} ${log.entity} ${log.workspace_name || ""} ${log.details || ""}`.toLowerCase();
    return haystack.includes(filter.toLowerCase());
  });

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Auditoria</h2>
      <p className="settings-section-desc">
        Historico de acoes importantes no sistema -- login, criacao/exclusao de colecoes e paginas,
        mudancas de acesso e de configuracoes. Horarios exibidos no fuso {settings?.timezone || "America/Sao_Paulo"}
        {" "}(configuravel em Geral).
      </p>

      <input
        className="input"
        placeholder="Filtrar por pessoa, acao, colecao..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 360 }}
      />

      {loading ? (
        <SkeletonList count={5} />
      ) : filtered.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhum registro encontrado.</p>
      ) : (
        <div className="card" style={{ overflow: "visible" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Acao</th>
                <th>Onde</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--color-text-muted)", fontSize: 13 }}>
                    {formatDateTime(log.created_at, settings?.timezone)}
                  </td>
                  <td>
                    {log.user_name ||
                      (log.user_email ? (
                        <span title="Usuario removido">{log.user_email}</span>
                      ) : (
                        "Sistema"
                      ))}
                  </td>
                  <td>
                    <span className="badge">{ACTION_LABELS[log.action] || log.action}</span>
                    <span style={{ marginLeft: 6, fontSize: 12, color: "var(--color-text-muted)" }}>{log.entity}</span>
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>{log.workspace_name || "--"}</td>
                  <td style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{log.details || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
