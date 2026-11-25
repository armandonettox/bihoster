import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "../api/powerbiConnections";
import CatalogSyncModal from "./CatalogSyncModal";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  getSyncStatus: vi.fn(),
  listTenantWorkspaces: vi.fn(),
  updateSyncSettings: vi.fn(),
  startSync: vi.fn(),
  getSyncJob: vi.fn(),
}));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/powerbiConnections", () => ({
  getSyncStatus: mocks.getSyncStatus,
  listTenantWorkspaces: mocks.listTenantWorkspaces,
  updateSyncSettings: mocks.updateSyncSettings,
  startSync: mocks.startSync,
  getSyncJob: mocks.getSyncJob,
}));

const connection = { id: 7, name: "Conta ficticia", tenant_id: "t", client_id: "c", client_secret_configured: true };

function status(parts: Partial<SyncStatus> = {}): SyncStatus {
  return { last_sync: null, workspace_ids: [], interval_hours: null, running_job_id: null, ...parts };
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getSyncStatus.mockResolvedValue(status());
  mocks.listTenantWorkspaces.mockResolvedValue([
    { id: "ws-a", name: "Financeiro" },
    { id: "ws-b", name: "Comercial" },
  ]);
  mocks.updateSyncSettings.mockImplementation(async (_id, settings) =>
    status({ workspace_ids: settings.workspace_ids, interval_hours: settings.interval_hours }),
  );
});

describe("CatalogSyncModal", () => {
  it("sem sincronizacao anterior, avisa e deixa todos os workspaces marcados", async () => {
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);

    expect(await screen.findByText("Esta conta ainda não foi sincronizada.")).toBeTruthy();
    expect((screen.getByLabelText("Todos os workspaces do tenant") as HTMLInputElement).checked).toBe(true);
  });

  it("mostra o resultado da ultima sincronizacao e se foi a agendada", async () => {
    mocks.getSyncStatus.mockResolvedValue(
      status({
        last_sync: {
          id: 1,
          started_at: "2026-11-25T10:00:00Z",
          finished_at: "2026-11-25T10:01:00Z",
          started_by_scheduler: true,
          reports_new: 3,
          reports_updated: 1,
          reports_missing: 2,
          datasets_new: 2,
          datasets_updated: 0,
          datasets_missing: 0,
          error: null,
        },
      }),
    );
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);

    expect(await screen.findByText(/3 relatórios novos, 1 atualizados, 2 não encontrados/)).toBeTruthy();
    expect(screen.getByText(/\(agendada\)/)).toBeTruthy();
  });

  it("escolher so alguns workspaces sem marcar nenhum e recusado antes de chamar o servidor", async () => {
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);
    await screen.findByText("Esta conta ainda não foi sincronizada.");

    fireEvent.click(screen.getByLabelText("Só os que eu escolher"));
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Escolha ao menos um workspace/);
    expect(mocks.updateSyncSettings).not.toHaveBeenCalled();
    expect(mocks.startSync).not.toHaveBeenCalled();
  });

  it("salva os workspaces escolhidos e a agenda", async () => {
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);
    await screen.findByText("Esta conta ainda não foi sincronizada.");

    fireEvent.click(screen.getByLabelText("Só os que eu escolher"));
    fireEvent.click(await screen.findByLabelText("Financeiro"));
    fireEvent.change(screen.getByLabelText("Sincronização automática"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar escolhas" }));

    await waitFor(() =>
      expect(mocks.updateSyncSettings).toHaveBeenCalledWith(7, { workspace_ids: ["ws-a"], interval_hours: 6 }),
    );
    expect(mocks.showToast).toHaveBeenCalledWith("Escolhas da sincronização salvas.");
  });

  it("sincronizar agora salva, inicia o trabalho, acompanha e avisa ao terminar", async () => {
    mocks.startSync.mockResolvedValue("job-1");
    mocks.getSyncJob
      .mockResolvedValueOnce({ status: "running", message: "Workspace 1 de 2", progress: 40, sync_id: null })
      .mockResolvedValue({ status: "done", message: "Sincronizacao concluida.", progress: 100, sync_id: 9 });
    const onFinished = vi.fn();
    render(<CatalogSyncModal connection={connection} onClose={() => {}} onFinished={onFinished} />);
    await screen.findByText("Esta conta ainda não foi sincronizada.");

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    expect(await screen.findByText("Workspace 1 de 2")).toBeTruthy();
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Catálogo sincronizado."), { timeout: 4000 });
    expect(mocks.updateSyncSettings).toHaveBeenCalledWith(7, { workspace_ids: [], interval_hours: null });
    expect(onFinished).toHaveBeenCalled();
  });

  it("se a sincronizacao falhar, mostra o motivo e nao diz que deu certo", async () => {
    mocks.startSync.mockResolvedValue("job-2");
    mocks.getSyncJob.mockResolvedValue({
      status: "error",
      message: "Falha ao autenticar na Azure AD: HTTP 401",
      progress: 100,
      sync_id: 3,
    });
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);
    await screen.findByText("Esta conta ainda não foi sincronizada.");

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/HTTP 401/);
    expect(mocks.showToast).not.toHaveBeenCalledWith("Catálogo sincronizado.");
  });

  it("retoma o acompanhamento quando a conta ja esta sincronizando", async () => {
    mocks.getSyncStatus.mockResolvedValue(status({ running_job_id: "job-9" }));
    mocks.getSyncJob.mockResolvedValue({
      status: "running",
      message: "Listando os workspaces do tenant.",
      progress: 5,
      sync_id: null,
    });
    render(<CatalogSyncModal connection={connection} onClose={() => {}} />);

    expect(await screen.findByText("Listando os workspaces do tenant.")).toBeTruthy();
    expect(mocks.getSyncJob).toHaveBeenCalledWith(7, "job-9");
    expect((screen.getByRole("button", { name: "Sincronizando..." }) as HTMLButtonElement).disabled).toBe(true);
  });
});
