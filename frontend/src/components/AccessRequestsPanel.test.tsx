import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/accessExtensions";
import type { ExtensionRequest } from "../api/accessExtensions";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../context/AccessContext";
import AccessRequestsPanel from "./AccessRequestsPanel";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/accessExtensions", () => ({
  listExtensionRequests: vi.fn(),
  approveRequest: vi.fn(),
  denyRequest: vi.fn(),
  revokeRelease: vi.fn(),
}));

const listar = vi.mocked(api.listExtensionRequests);
const aprovar = vi.mocked(api.approveRequest);
const recusar = vi.mocked(api.denyRequest);
const encerrar = vi.mocked(api.revokeRelease);

function pedido(extra: Partial<ExtensionRequest> = {}): ExtensionRequest {
  return {
    id: 4,
    user_id: 7,
    user_name: "MARIA DA SILVA",
    user_email: "maria@x.com",
    reason: "Fechar o relatorio do mes",
    status: "pending",
    created_at: "2026-11-21T13:00:00Z",
    decided_at: null,
    decided_by_name: null,
    note: null,
    grant_until: null,
    active: false,
    ...extra,
  };
}

function abrir(acesso = ADMIN_ACCESS) {
  return render(
    <AccessContext.Provider value={buildAccess(acesso)}>
      <AccessRequestsPanel timezone="America/Sao_Paulo" />
    </AccessContext.Provider>,
  );
}

beforeEach(() => {
  mocks.showToast.mockClear();
  for (const fn of [listar, aprovar, recusar, encerrar]) fn.mockReset();
  listar.mockResolvedValue([]);
  aprovar.mockResolvedValue(pedido({ status: "approved" }));
  recusar.mockResolvedValue(pedido({ status: "denied" }));
  encerrar.mockResolvedValue(pedido({ status: "revoked" }));
});

describe("AccessRequestsPanel", () => {
  it("sem pedidos nem liberacoes nao aparece nada", async () => {
    const { container } = abrir();
    await waitFor(() => expect(listar).toHaveBeenCalled());

    expect(container.querySelector(".access-requests")).toBeNull();
  });

  it("quem nao pode liberar nao ve o painel nem consulta a lista", async () => {
    const { container } = abrir({ is_admin: false, global_permissions: ["membros.ver"], workspace_permissions: {} });

    expect(container.querySelector(".access-requests")).toBeNull();
    expect(listar).not.toHaveBeenCalled();
  });

  it("mostra o pedido com quem pediu (nome formatado), o motivo e a quantidade", async () => {
    listar.mockResolvedValue([pedido()]);
    abrir();

    expect(await screen.findByText("Pedidos de horário (1)")).toBeTruthy();
    expect(screen.getByText("Maria da Silva")).toBeTruthy();
    expect(screen.getByText("Fechar o relatorio do mes")).toBeTruthy();
  });

  it("aprovar com a duracao padrao manda 2 horas em minutos", async () => {
    listar.mockResolvedValue([pedido()]);
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Liberar" }));

    await waitFor(() => expect(aprovar).toHaveBeenCalledWith(4, { minutes: 120 }));
    expect(mocks.showToast).toHaveBeenCalledWith("Acesso liberado para Maria da Silva.");
  });

  it("aprovar ate um horario manda o horario escolhido", async () => {
    listar.mockResolvedValue([pedido()]);
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }));
    fireEvent.change(screen.getByLabelText("Por quanto tempo"), { target: { value: "time" } });
    fireEvent.change(screen.getByLabelText(/^Até as/), { target: { value: "21:30" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Liberar" }));

    await waitFor(() => expect(aprovar).toHaveBeenCalledWith(4, { until_time: "21:30" }));
  });

  it("recusar manda o motivo digitado", async () => {
    listar.mockResolvedValue([pedido()]);
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    fireEvent.change(screen.getByLabelText("Motivo da recusa (opcional)"), { target: { value: "  Fecha amanha  " } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Recusar" }));

    await waitFor(() => expect(recusar).toHaveBeenCalledWith(4, "Fecha amanha"));
    expect(mocks.showToast).toHaveBeenCalledWith("Pedido recusado.");
  });

  it("liberacao valendo mostra ate quando e deixa encerrar", async () => {
    listar.mockResolvedValue([pedido({ status: "approved", active: true, grant_until: "2026-11-21T15:00:00Z" })]);
    abrir();

    expect(await screen.findByText(/está liberada até/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar liberação" }));
    await waitFor(() => expect(encerrar).toHaveBeenCalledWith(4));
  });

  it("pedido ja decidido e liberacao que acabou nao entram no painel", async () => {
    listar.mockResolvedValue([pedido({ id: 1, status: "denied" }), pedido({ id: 2, status: "approved", active: false })]);
    const { container } = abrir();
    await waitFor(() => expect(listar).toHaveBeenCalled());

    expect(container.querySelector(".access-requests")).toBeNull();
  });

  it("erro do servidor aparece e o painel continua", async () => {
    listar.mockResolvedValue([pedido()]);
    aprovar.mockRejectedValue({ response: { data: { detail: "Esse pedido já foi respondido." } } });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Liberar" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Esse pedido já foi respondido.", "error"));
  });
});
