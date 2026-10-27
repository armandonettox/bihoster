import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBranding } from "../context/BrandingContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useAuth } from "../context/AuthContext";
import HomeDashboard from "./HomeDashboard";

function firstName(name?: string): string {
  return (name || "").split(" ")[0] || "";
}

export default function Home() {
  const { settings, loaded } = useBranding();
  const { user } = useAuth();
  const { currentWorkspace, workspaces, loading: workspacesLoading, selectWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const ready = loaded && !workspacesLoading;

  useEffect(() => {
    if (!ready) return;

    // Coleção inicial configurada pelo admin tem prioridade
    const defaultId = settings?.default_workspace_id;
    if (defaultId) {
      const hasAccess = workspaces.some((w) => w.id === defaultId);
      if (hasAccess) {
        if (currentWorkspace?.id !== defaultId) selectWorkspace(defaultId);
        navigate("/collection", { replace: true });
        return;
      }
    }

    // Redireciona para a unica colecao quando o toggle esta ativo
    if (settings?.single_collection_redirect && workspaces.length === 1) {
      const targetId = workspaces[0].id;
      if (currentWorkspace?.id !== targetId) selectWorkspace(targetId);
      navigate("/collection", { replace: true });
    }
  }, [ready, settings?.default_workspace_id, settings?.single_collection_redirect, workspaces, currentWorkspace?.id, navigate, selectWorkspace]);

  // Aguarda o carregamento antes de decidir o que mostrar (evita piscar o painel)
  if (!ready) {
    return null;
  }

  return (
    <div>
      <div className="settings-header">
        <h1>Ola, {firstName(user?.name) || "tudo bem"}</h1>
        <p>Suas colecoes, recomendacoes e relatorios recentes.</p>
      </div>
      <HomeDashboard />
    </div>
  );
}
