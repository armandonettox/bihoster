import { useEffect, useState } from "react";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";

// Campo "Tempo (s)" do Modo TV: guarda o valor digitado e so grava no servidor ao sair do campo.
export function useTvInterval(workspace: Workspace | null | undefined, reload: () => unknown) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("15");

  useEffect(() => {
    if (workspace) setDraft(String(workspace.tv_interval_seconds));
  }, [workspace?.id, workspace?.tv_interval_seconds]);

  async function commit(rawValue: string) {
    if (!workspace) return;
    // Campo vazio nao e numero: Number("") vale 0 e cairia no minimo (3 s), gravando um valor que
    // ninguem digitou. Vazio volta pro valor salvo, igual a qualquer outro texto invalido.
    const parsed = rawValue.trim() === "" ? NaN : Number(rawValue);
    // So envia ao backend quando o valor digitado for um numero valido dentro do intervalo
    // permitido -- evita gravar 0 (ou lixo) momentaneamente enquanto o campo esta sendo editado.
    const seconds = Number.isFinite(parsed) ? Math.min(3600, Math.max(3, Math.round(parsed))) : workspace.tv_interval_seconds;
    setDraft(String(seconds));
    if (seconds === workspace.tv_interval_seconds) return;
    try {
      await workspacesApi.updateWorkspace(workspace.id, { tv_interval_seconds: seconds });
      await reload();
    } catch (err: any) {
      // Volta o campo pro valor que realmente esta salvo, em vez de mostrar um valor que nao foi gravado
      setDraft(String(workspace.tv_interval_seconds));
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar o intervalo da TV.", "error");
    }
  }

  return { draft, setDraft, commit };
}
