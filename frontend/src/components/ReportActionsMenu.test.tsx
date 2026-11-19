import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeReport } from "../test-fixtures";
import ReportActionsMenu from "./ReportActionsMenu";

const RELATORIO = makeReport(5, { name: "Vendas" });

// Sem nenhuma funcao de acao, o menu so tem os favoritos: cada item aparece so quando a tela entrega a funcao dele
function abrir(props: Partial<Parameters<typeof ReportActionsMenu>[0]> = {}) {
  render(<ReportActionsMenu report={RELATORIO} isFavorite={false} onToggleFavorite={vi.fn()} {...props} />);
  fireEvent.click(screen.getByLabelText("Mais opcoes"));
}

describe("ReportActionsMenu", () => {
  it("quem so le ve apenas os favoritos", () => {
    abrir();

    expect(screen.getByRole("button", { name: "Adicionar aos favoritos" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar por e-mail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Atualizar miniatura" })).toBeNull();
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

  it("cada item aparece so quando a tela entrega a funcao dele: editar nao traz excluir nem miniatura", () => {
    abrir({ onEdit: vi.fn() });

    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Atualizar miniatura" })).toBeNull();
  });

  it("quem so pode excluir ve Excluir e mais nada", () => {
    abrir({ onDelete: vi.fn() });

    expect(screen.getByRole("button", { name: "Excluir" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("quem so gerencia a miniatura ve Atualizar miniatura e mais nada", () => {
    abrir({ onRefreshThumbnail: vi.fn() });

    expect(screen.getByRole("button", { name: "Atualizar miniatura" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("a opcao de enviar nao depende das outras", () => {
    abrir({ onEdit: vi.fn(), onDelete: vi.fn(), onRefreshThumbnail: vi.fn(), onSendByEmail: vi.fn() });

    for (const nome of ["Editar", "Excluir", "Atualizar miniatura", "Enviar por e-mail"]) {
      expect(screen.getByRole("button", { name: nome })).toBeTruthy();
    }
  });

  it("clicar em Editar e em Excluir chama cada funcao", () => {
    const editar = vi.fn();
    const excluir = vi.fn();
    abrir({ onEdit: editar, onDelete: excluir });

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(editar).toHaveBeenCalledWith(RELATORIO);

    fireEvent.click(screen.getByLabelText("Mais opcoes"));
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(excluir).toHaveBeenCalledWith(RELATORIO.id);
  });
});
