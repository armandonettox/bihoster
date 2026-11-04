import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeReport } from "../test-fixtures";
import ReportActionsMenu from "./ReportActionsMenu";

const RELATORIO = makeReport(5, { name: "Vendas" });

function abrir(props: Partial<Parameters<typeof ReportActionsMenu>[0]> = {}) {
  render(
    <ReportActionsMenu
      report={RELATORIO}
      canWrite={false}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
  );
  fireEvent.click(screen.getByLabelText("Mais opcoes"));
}

describe("ReportActionsMenu", () => {
  it("quem so le ve apenas os favoritos", () => {
    abrir();

    expect(screen.getByRole("button", { name: "Adicionar aos favoritos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar por e-mail" })).toBeNull();
  });

  it("o item Enviar por e-mail so aparece quando a funcao e liberada", () => {
    abrir({ onSendByEmail: vi.fn() });

    expect(screen.getByRole("button", { name: "Enviar por e-mail" })).toBeTruthy();
  });

  it("clicar em Enviar por e-mail chama a funcao com o relatorio e fecha o menu", () => {
    const enviar = vi.fn();
    abrir({ onSendByEmail: enviar });

    fireEvent.click(screen.getByRole("button", { name: "Enviar por e-mail" }));

    expect(enviar).toHaveBeenCalledWith(RELATORIO);
    expect(screen.queryByRole("button", { name: "Enviar por e-mail" })).toBeNull();
  });

  it("a opcao de enviar nao depende de poder editar (quem edita ve Editar e Excluir tambem)", () => {
    abrir({ canWrite: true, onSendByEmail: vi.fn() });

    for (const nome of ["Editar", "Excluir", "Enviar por e-mail"]) {
      expect(screen.getByRole("button", { name: nome })).toBeTruthy();
    }
  });
});
