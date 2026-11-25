import { useEffect, useState } from "react";
import { extractErrorMessage } from "../api/client";
import * as securityApi from "../api/datasetSecurity";
import type { RoleGrant } from "../api/datasetSecurity";
import * as groupsApi from "../api/groups";
import type { Group } from "../api/groups";
import * as usersApi from "../api/users";
import type { UserDirectoryEntry } from "../api/users";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";

interface Row {
  key: string;
  group_id: number | null;
  user_id: number | null;
  label: string;
  role: string;
}

function toRow(grant: RoleGrant): Row {
  return {
    key: `${grant.group_id ?? "u" + grant.user_id}:${grant.pbi_role}`,
    group_id: grant.group_id,
    user_id: grant.user_id,
    label: grant.group_id != null ? `Grupo ${grant.subject_name}` : `${grant.subject_name} (${grant.subject_email ?? ""})`,
    role: grant.pbi_role,
  };
}

/** Segurança de um modelo semântico: que função de RLS e OLS do Power BI cada grupo e cada pessoa recebe. As funções são
 * criadas no Power BI; aqui só se escolhe quem recebe qual. Com ao menos uma função mapeada, o modelo passa a exigir função
 * para abrir os relatórios dele (falha fechada); sem nenhuma, tudo funciona como antes. */
export default function DatasetSecurityModal({
  datasetId,
  datasetName,
  onClose,
  onSaved,
}: {
  datasetId: number;
  datasetName: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [shared, setShared] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [security, groupList, userList] = await Promise.all([
          securityApi.getDatasetSecurity(datasetId),
          groupsApi.listGroups().catch(() => [] as Group[]),
          usersApi.listUsers().catch(() => [] as UserDirectoryEntry[]),
        ]);
        if (cancelled) return;
        setRows(security.grants.map(toRow));
        setShared(security.rls_shared_by_roles === true);
        setGroups(groupList);
        setUsers(userList);
      } catch (err) {
        if (!cancelled) setError(extractErrorMessage(err) || "Não foi possível ler a segurança do modelo.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  function add() {
    const name = role.trim();
    if (!subject || !name) {
      setError("Escolha um grupo ou uma pessoa e digite o nome da função.");
      return;
    }
    setError(null);
    const [kind, rawId] = subject.split(":");
    const id = Number(rawId);
    const group = kind === "g" ? groups.find((g) => g.id === id) : undefined;
    const user = kind === "u" ? users.find((u) => u.id === id) : undefined;
    const next: Row = {
      key: `${kind === "g" ? id : "u" + id}:${name}`,
      group_id: kind === "g" ? id : null,
      user_id: kind === "u" ? id : null,
      label: group ? `Grupo ${group.name}` : user ? `${user.name} (${user.email})` : subject,
      role: name,
    };
    setRows((prev) => (prev.some((row) => row.key === next.key) ? prev : [...prev, next]));
    setRole("");
  }

  async function test() {
    const name = role.trim();
    if (!name) {
      setError("Digite o nome da função para testar.");
      return;
    }
    setError(null);
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await securityApi.testDatasetRole(datasetId, name);
      setTestMessage({ ok: result.ok, text: result.message });
    } catch (err) {
      setTestMessage({ ok: false, text: extractErrorMessage(err) || "Não foi possível testar a função." });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await securityApi.saveDatasetSecurity(datasetId, {
        rls_shared_by_roles: shared ? true : null,
        grants: rows.map((row) => ({ group_id: row.group_id, user_id: row.user_id, pbi_role: row.role })),
      });
      showToast("Segurança do modelo salva.");
      onSaved?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Não foi possível salvar a segurança do modelo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Segurança: ${datasetName}`} onClose={onClose} wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
          Escolha que <strong>função</strong> do Power BI cada grupo e cada pessoa recebe neste modelo. A função precisa existir no modelo
          (o portal não a cria) e é ela que limita as linhas (RLS) e as colunas (OLS). Quem recebe mais de uma vê a soma delas.
        </p>
        <p className="auth-error" style={{ margin: 0 }} role="note">
          Com ao menos uma função aqui, <strong>quem não receber nenhuma não abre os relatórios deste modelo</strong>, nem
          administradores: crie no modelo uma função sem filtro e dê a ela o grupo Administradores. Sem nenhuma função, o modelo volta a
          funcionar como antes.
        </p>

        {loading ? (
          <p>Carregando...</p>
        ) : (
          <>
            {rows.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>Nenhuma função mapeada: este modelo funciona como antes.</p>
            ) : (
              <div className="audit-table-card">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Quem</th>
                      <th scope="col">Função no Power BI</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.role}</td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "1 1 220px" }}>
                Grupo ou pessoa
                <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="">Escolha</option>
                  <optgroup label="Grupos">
                    {groups.map((g) => (
                      <option key={`g${g.id}`} value={`g:${g.id}`}>
                        {g.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Pessoas">
                    {users.map((u) => (
                      <option key={`u${u.id}`} value={`u:${u.id}`}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className="field" style={{ flex: "1 1 180px" }}>
                Função
                <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex: Regional A" />
              </label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={add}>
                Adicionar
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void test()} disabled={testing}>
                {testing ? "Testando..." : "Testar função"}
              </button>
            </div>
            {testMessage && (
              <p role="status" className={testMessage.ok ? undefined : "auth-error"} style={{ margin: 0 }}>
                {testMessage.text}
              </p>
            )}

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 400 }}>
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                O RLS deste modelo depende só das funções (nenhuma regra usa o usuário, como <code>USERNAME()</code>): pessoas com o mesmo
                conjunto de funções dividem o mesmo acesso e gastam menos capacidade. <strong>Em dúvida, deixe desmarcado.</strong>
              </span>
            </label>
          </>
        )}

        {error && (
          <p className="auth-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => void save()} disabled={saving || loading}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
