import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBranding } from "../context/BrandingContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useAuth } from "../context/AuthContext";
import HomeDashboard from "./HomeDashboard";

function firstName(name?: string): string {
  return (name || "").split(" ")[0] || "";
}

export default function Home() {
  const { settings } = useBranding();
  const { user } = useAuth();
  const { currentWorkspace, workspaces, loading: workspacesLoading, selectWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const workspaceId = settings?.default_workspace_id;

    if (!workspaceId) {
      setRedirecting(false);
      return;
    }

    if (workspacesLoading) return;

    const hasAccess = workspaces.some((w) => w.id === workspaceId);
    if (!hasAccess) {
      setRedirecting(false);
      return;
    }

    if (currentWorkspace?.id !== workspaceId) {
      selectWorkspace(workspaceId);
    }
    navigate("/collection");
  }, [settings?.default_workspace_id, currentWorkspace?.id, workspacesLoading, workspaces, navigate, selectWorkspace]);

  if (redirecting && settings?.default_workspace_id) {
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
