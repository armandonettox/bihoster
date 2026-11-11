import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "../../api/audit";
import RevertDialog from "./RevertDialog";

const mocks = vi.hoisted(() => ({ revert: vi.fn() }));
vi.mock("../../api/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/audit")>()),
  revertAuditAction: mocks.revert,
}));

const ENTRY = {
  id: 42,
  revertible: true,
  revert_summary: 'Voltar da colecao: nome de "Financeiro" para "Comercial"',
} as AuditLogEntry;

function conflictError(detail: Record<string, unknown>) {
  return { response: { status: 409, data: { detail } } };
}

const onReverted = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  mocks.revert.mockReset();
  onReverted.mockReset();
  onClose.mockReset();
});

const open = () => render(<RevertDialog entry={ENTRY} onReverted={onReverted} onClose={onClose} />);

describe("RevertDialog", () => {
  it("mostra o que vai acontecer e avisa que a reversao fica registrada", () => {
    open();
    expect(screen.getByText('Voltar da colecao: nome de "Financeiro" para "Comercial"')).toBeTruthy();
    expect(screen.getByText(/fica registrada na auditoria/)).toBeTruthy();
  });

  it("Reverter chama o servidor sem forcar e devolve o resumo", async () => {
    mocks.revert.mockResolvedValue({ status: "reverted", summary: "Voltou o nome" });
    open();

    fireEvent.click(screen.getByRole("button", { name: "Reverter" }));

    await waitFor(() => expect(onReverted).toHaveBeenCalledWith("Voltou o nome"));
    expect(mocks.revert).toHaveBeenCalledWith(42, false);
  });

  it("Cancelar fecha sem chamar o servidor", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.revert).not.toHaveBeenCalled();
  });

  it("se o item mudou depois, mostra o antes, o agora e o que fica, e so reverte com a segunda confirmacao", async () => {
    mocks.revert.mockRejectedValueOnce(
      conflictError({
        code: "conflict",
        message: "Este item foi alterado depois dessa acao.",
        expected: "nome: Financeiro",
        current: "nome: Vendas",
        after_revert: "nome: Comercial",
      }),
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reverter" }));

    expect(await screen.findByText("Este item mudou depois dessa acao")).toBeTruthy();
    expect(screen.getByText("nome: Financeiro")).toBeTruthy();
    expect(screen.getByText("nome: Vendas")).toBeTruthy();
    expect(screen.getByText("nome: Comercial")).toBeTruthy();
    expect(onReverted).not.toHaveBeenCalled();

    mocks.revert.mockResolvedValueOnce({ status: "reverted", summary: "Voltou" });
    fireEvent.click(screen.getByRole("button", { name: "Reverter mesmo assim" }));

    await waitFor(() => expect(onReverted).toHaveBeenCalledWith("Voltou"));
    expect(mocks.revert).toHaveBeenLastCalledWith(42, true);
  });

  it("item que nao existe mais: avisa e so oferece fechar", async () => {
    mocks.revert.mockRejectedValue(conflictError({ code: "gone", message: "A colecao nao existe mais: nao ha o que reverter." }));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reverter" }));

    expect(await screen.findByText("A colecao nao existe mais: nao ha o que reverter.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reverter/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("outro erro (ex: regra de seguranca) aparece na propria janela e ela continua aberta", async () => {
    mocks.revert.mockRejectedValue({
      response: { status: 400, data: { detail: "Nao e possivel remover o ultimo administrador da plataforma" } },
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reverter" }));

    expect((await screen.findByRole("alert")).textContent).toContain("ultimo administrador");
    expect(onReverted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reverter" })).toBeTruthy();
  });
});
