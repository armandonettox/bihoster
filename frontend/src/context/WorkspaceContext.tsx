import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as workspacesApi from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { safeStorage } from "../utils/safeStorage";
import { useToast } from "./ToastContext";

interface WorkspaceContextValue {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  loading: boolean;
  selectWorkspace: (id: number) => void;
  reload: () => Promise<void>;
  reloadAndSelect: (id: number) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const STORAGE_KEY = "current_workspace_id";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const reload = useCallback(async () => {
    const data = await workspacesApi.listWorkspaces();
    setWorkspaces(data);

    const storedId = Number(safeStorage.getItem(STORAGE_KEY));
    const stillValid = data.find((w) => w.id === storedId);
    setCurrentWorkspace(stillValid || data[0] || null);
  }, []);

  // Busca a lista atualizada e forca a selecao de um workspace especifico (ex: recem criado/entrado).
  // Nao depende do estado `workspaces` antigo, evitando corrida com o setState assincrono do reload().
  const reloadAndSelect = useCallback(async (id: number) => {
    const data = await workspacesApi.listWorkspaces();
    setWorkspaces(data);

    const target = data.find((w) => w.id === id) || data[0] || null;
    setCurrentWorkspace(target);
    if (target) {
      safeStorage.setItem(STORAGE_KEY, String(target.id));
    }
  }, []);

  useEffect(() => {
    reload()
      .catch(() => showToast("Nao foi possivel carregar suas colecoes.", "error"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  function selectWorkspace(id: number) {
    const workspace = workspaces.find((w) => w.id === id);
    if (workspace) {
      setCurrentWorkspace(workspace);
      safeStorage.setItem(STORAGE_KEY, String(id));
    }
  }

  return (
    <WorkspaceContext.Provider value={{ workspaces, currentWorkspace, loading, selectWorkspace, reload, reloadAndSelect }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace precisa ser usado dentro de um WorkspaceProvider");
  }
  return context;
}
