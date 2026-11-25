import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import type { PowerBIConnection } from "../api/powerbiConnections";
import { AccessContext, buildAccess } from "../context/AccessContext";
import PowerBiConnectionsSection from "./PowerBiConnectionsSection";

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../api/powerbiConnections", () => ({
  listConnections: mocks.listConnections,
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("../api/powerbi", () => ({ listPowerBIWorkspaces: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("./CatalogSyncModal", () => ({ default: ({ connection }: { connection: { name: string } }) => <div data-testid="sincronizar">{connection.name}</div> }));
vi.mock("./reports/PermissionsPanel", () => ({
  default: ({ kind, itemName }: { kind: string; itemName: string }) => <div data-testid="painel">{`${kind}:${itemName}`}</div>,
}));

function conta(parts: Partial<PowerBIConnection> = {}): PowerBIConnection {
  return { id: 1, name: "Conta A", tenant_id: "tenant-a", client_id: "client-a", client_secret_configured: true, sync_interval_hours: null, last_sync_at: null, next_sync_at: null, ...parts };
}

function renderSection(me: Partial<MyAccess>) {
  return render(
    <AccessContext.Provider value={buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me })}>
      <PowerBiConnectionsSection />
    </AccessContext.Provider>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listConnections.mockResolvedValue([conta(), conta({ id: 2, name: "Conta B", tenant_id: "tenant-b" })]);
});

describe("PowerBiConnectionsSection: agenda da sincronizacao", () => {
  it("por padrao diz que a sincronizacao automatica esta desligada", async () => {
    renderSection({ is_admin: true });

    expect((await screen.findByTestId("agenda-1")).textContent).toBe("Sincronização automática: desligada");
  });

  it("ligada mostra o intervalo, a proxima rodada e a ultima", async () => {
    mocks.listConnections.mockResolvedValue([conta({ sync_interval_hours: 6, next_sync_at: "2026-11-25T18:00:00Z", last_sync_at: "2026-11-25T12:00:00Z" })]);
    renderSection({ is_admin: true });

    const texto = (await screen.findByTestId("agenda-1")).textContent ?? "";
    expect(texto).toMatch(/a cada 6 horas/);
    expect(texto).toMatch(/próxima em/);
    expect(texto).toMatch(/última em/);
  });

  it("com intervalo e sem rodada ainda, explica em vez de inventar uma data", async () => {
    mocks.listConnections.mockResolvedValue([conta({ sync_interval_hours: 24 })]);
    renderSection({ is_admin: true });

    expect((await screen.findByTestId("agenda-1")).textContent).toMatch(/todos os dias · próxima na verificação seguinte/);
  });

  it("os nomes dos intervalos de uma hora e de uma semana", async () => {
    mocks.listConnections.mockResolvedValue([conta({ sync_interval_hours: 1 }), conta({ id: 2, sync_interval_hours: 168 })]);
    renderSection({ is_admin: true });

    expect((await screen.findByTestId("agenda-1")).textContent).toMatch(/a cada hora/);
    expect(screen.getByTestId("agenda-2").textContent).toMatch(/toda semana/);
  });
});

describe("PowerBiConnectionsSection: permissoes por conta", () => {
  it("o botao Sincronizar aparece so nas contas em que a pessoa pode", async () => {
    renderSection({ global_permissions: ["conexao.ver"], connection_permissions: { "2": ["conexao.sincronizar"] } });
    await screen.findByTestId("agenda-1");

    const cartaoA = screen.getByText("Conta A").closest(".card") as HTMLElement;
    const cartaoB = screen.getByText("Conta B").closest(".card") as HTMLElement;
    expect(within(cartaoA).queryByRole("button", { name: "Sincronizar" })).toBeNull();
    fireEvent.click(within(cartaoB).getByRole("button", { name: "Sincronizar" }));
    expect(screen.getByTestId("sincronizar").textContent).toBe("Conta B");
  });

  it("a permissao geral de sincronizar vale em todas as contas", async () => {
    renderSection({ global_permissions: ["conexao.ver", "conexao.sincronizar"] });
    await screen.findByTestId("agenda-1");

    expect(screen.getAllByRole("button", { name: "Sincronizar" }).length).toBe(2);
  });

  it("so quem edita permissoes tem Gerenciar permissoes no menu da conta, e abre o painel dela", async () => {
    const { unmount } = renderSection({ global_permissions: ["conexao.ver"] });
    await screen.findByTestId("agenda-1");
    fireEvent.click(within(screen.getByText("Conta A").closest(".card") as HTMLElement).getByRole("button", { name: "Mais opcoes" }));
    expect(screen.queryByText("Gerenciar permissões")).toBeNull();
    unmount();

    renderSection({ global_permissions: ["conexao.ver", "permissoes.editar"] });
    await screen.findByTestId("agenda-1");
    fireEvent.click(within(screen.getByText("Conta A").closest(".card") as HTMLElement).getByRole("button", { name: "Mais opcoes" }));
    fireEvent.click(await screen.findByText("Gerenciar permissões"));

    await waitFor(() => expect(screen.getByTestId("painel").textContent).toBe("connection:Conta A"));
  });
});
