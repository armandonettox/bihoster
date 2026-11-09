import { useEffect, useState } from "react";
import * as groupsApi from "../api/groups";
import type { Group, GroupPermissions } from "../api/groups";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";

const OPTIONS = [
  {
    key: groupsApi.AI_PERMISSION_MANAGE,
    label: "Gerenciar IA",
    help: "Cadastrar chaves de API, escolher modelos e ativar provedores.",
  },
  {
    key: groupsApi.AI_PERMISSION_USE,
    label: "Usar o chat de IA",
    help: "Fazer perguntas sobre os dados dos relatorios que a pessoa ja pode ver.",
  },
];

/** Permissoes de IA de um grupo. Cada caixa salva na hora. A pessoa tem a permissao se qualquer
 * grupo dela tiver; o grupo Administradores tem todas sempre. */
export default function GroupAiPermissions({ group }: { group: Group }) {
  const { showToast } = useToast();
  const [state, setState] = useState<GroupPermissions | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    groupsApi
      .getGroupPermissions(group.id)
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [group.id]);

  async function toggle(key: string, checked: boolean) {
    if (!state) return;
    const next = new Set(state.permissions);
    if (checked) next.add(key);
    else next.delete(key);
    setSaving(true);
    try {
      setState(await groupsApi.setGroupPermissions(group.id, [...next]));
      showToast("Permissoes de IA atualizadas.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar as permissoes.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as permissoes de IA.</p>;
  if (!state) return null;

  return (
    <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
      <legend style={{ fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>Permissoes de IA</legend>
      {OPTIONS.map((option) => (
        <label key={option.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={state.permissions.includes(option.key)}
            disabled={!state.editable || saving}
            onChange={(e) => toggle(option.key, e.target.checked)}
          />
          <span>
            {option.label}
            <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)" }}>{option.help}</span>
          </span>
        </label>
      ))}
      {!state.editable && (
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
          O grupo Administradores sempre tem todas as permissoes.
        </p>
      )}
    </fieldset>
  );
}
