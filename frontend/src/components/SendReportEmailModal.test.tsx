import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as deliveryApi from "../api/reportDelivery";
import type { DeliveryStatus } from "../api/reportDelivery";
import { makeReport } from "../test-fixtures";
import SendReportEmailModal from "./SendReportEmailModal";

vi.mock("../api/reportDelivery", () => ({ exportReportByEmail: vi.fn(), getDeliveryStatus: vi.fn() }));

const exportar = vi.mocked(deliveryApi.exportReportByEmail);
const status = vi.mocked(deliveryApi.getDeliveryStatus);
const RELATORIO = makeReport(34, { name: "Vendas Mensal" });

function andamento(s: string, message: string, progress = 0): DeliveryStatus {
  return { status: s, message, progress };
}

async function abrir(onClose = vi.fn()) {
  render(<SendReportEmailModal report={RELATORIO} workspaceId={3} defaultEmail="admin@empresa.com" onClose={onClose} />);
  return onClose;
}

/** Deixa as promessas pendentes terminarem e avanca o relogio simulado */
async function avancar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function enviar() {
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await avancar();
}

beforeEach(() => {
  vi.useFakeTimers();
  exportar.mockResolvedValue("job-1");
  status.mockResolvedValue(andamento("exporting", "Exportando o relatorio no Power BI...", 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SendReportEmailModal - formulario", () => {
  it("abre com o e-mail de quem esta logado e o PDF escolhido", async () => {
    await abrir();

    expect((screen.getByLabelText("Enviar para") as HTMLInputElement).value).toBe("admin@empresa.com");
    expect((screen.getByLabelText("Formato") as HTMLSelectElement).value).toBe("PDF");
    expect(screen.getByText("Vendas Mensal")).toBeTruthy();
  });

  it("envia o pedido com o destino e o formato escolhidos", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Enviar para"), { target: { value: "  outra@empresa.com " } });
    fireEvent.change(screen.getByLabelText("Formato"), { target: { value: "PPTX" } });

    await enviar();

    expect(exportar).toHaveBeenCalledWith(3, 34, "outra@empresa.com", "PPTX");
  });

  it("sem destino o botao Enviar fica desligado", async () => {
    await abrir();

    fireEvent.change(screen.getByLabelText("Enviar para"), { target: { value: "   " } });

    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mostra o motivo quando o servidor recusa o pedido e deixa tentar de novo", async () => {
    exportar.mockRejectedValue({ response: { data: { detail: "Esse e-mail esta fora dos dominios permitidos." } } });
    await abrir();

    await enviar();

    expect(screen.getByText("Esse e-mail esta fora dos dominios permitidos.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeTruthy();
    expect(status).not.toHaveBeenCalled();
  });

  it("Cancelar fecha a janela", async () => {
    const fechar = await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fechar).toHaveBeenCalledTimes(1);
  });
});

describe("SendReportEmailModal - acompanhamento", () => {
  it("mostra o andamento da exportacao com a barra de progresso", async () => {
    await abrir();

    await enviar();

    expect(screen.getByText("Exportando o relatorio no Power BI...")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("30");
    expect(status).toHaveBeenCalledWith(3, "job-1");
  });

  it("consulta de novo a cada 2 segundos ate terminar e para de consultar", async () => {
    status
      .mockResolvedValueOnce(andamento("exporting", "Exportando o relatorio no Power BI...", 30))
      .mockResolvedValueOnce(andamento("sending", "Enviando o e-mail..."))
      .mockResolvedValue(andamento("done", "E-mail enviado.", 100));
    await abrir();

    await enviar();
    expect(status).toHaveBeenCalledTimes(1);
    await avancar(2000);
    expect(screen.getByText("Enviando o e-mail...")).toBeTruthy();
    await avancar(2000);

    expect(screen.getByText("E-mail enviado.")).toBeTruthy();
    expect(screen.getByText(/Enviado para admin@empresa.com/)).toBeTruthy();
    // Dois botoes "Fechar": o X da janela e o do rodape
    expect(screen.getAllByRole("button", { name: "Fechar" })).toHaveLength(2);
    await avancar(20000);
    expect(status).toHaveBeenCalledTimes(3);
  });

  it("mostra o erro do envio e diz que nada foi enviado", async () => {
    status.mockResolvedValue(andamento("error", "capacidade sem suporte a exportacao"));
    await abrir();

    await enviar();

    expect(screen.getByText("capacidade sem suporte a exportacao")).toBeTruthy();
    expect(screen.getByText("Nada foi enviado.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("uma falha de rede no acompanhamento nao derruba: tenta de novo no proximo ciclo", async () => {
    status
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValue(andamento("done", "E-mail enviado.", 100));
    await abrir();

    await enviar();
    await avancar(2000);

    expect(screen.getByText("E-mail enviado.")).toBeTruthy();
  });

  it("desiste de acompanhar depois de 6 minutos e avisa que o envio segue no servidor", async () => {
    await abrir();
    await enviar();

    await avancar(6 * 60 * 1000 + 3000);

    expect(screen.getByText("O envio esta demorando mais que o normal.")).toBeTruthy();
    expect(screen.getByText(/continua no servidor/)).toBeTruthy();
    const chamadas = status.mock.calls.length;
    await avancar(60000);
    expect(status.mock.calls.length).toBe(chamadas);
  });

  it("fechar a janela no meio do envio para de consultar", async () => {
    const { unmount } = render(
      <SendReportEmailModal report={RELATORIO} workspaceId={3} defaultEmail="a@b.com" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await avancar();
    const chamadas = status.mock.calls.length;

    unmount();
    await avancar(20000);

    expect(status.mock.calls.length).toBe(chamadas);
  });

  it("durante o envio o botao avisa que pode fechar e continuar em segundo plano", async () => {
    const fechar = await abrir();
    await enviar();

    fireEvent.click(screen.getByRole("button", { name: "Fechar e continuar em segundo plano" }));

    expect(fechar).toHaveBeenCalledTimes(1);
  });
});
