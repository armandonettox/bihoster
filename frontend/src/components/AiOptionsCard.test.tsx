import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiApi from "../api/aiSettings";
import type { AIOptions } from "../api/aiSettings";
import AiOptionsCard from "./AiOptionsCard";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/aiSettings", () => ({ getAIOptions: vi.fn(), updateAIOptions: vi.fn() }));

const get = vi.mocked(aiApi.getAIOptions);
const update = vi.mocked(aiApi.updateAIOptions);

const PADRAO: AIOptions = {
  retention_days: 30,
  default_retention_days: 30,
  daily_question_limit: 50,
  default_daily_question_limit: 50,
  openrouter_monthly_budget_usd: null,
};

async function abrir(dados: AIOptions = PADRAO) {
  get.mockResolvedValue(dados);
  render(<AiOptionsCard />);
  await screen.findByText("Chat: historico, limites e orcamento");
}

const campo = (nome: string) => screen.getByLabelText(new RegExp(`^${nome}`)) as HTMLInputElement;

beforeEach(() => {
  mocks.showToast.mockClear();
  get.mockReset();
  update.mockReset();
  update.mockImplementation(async () => PADRAO);
});

describe("AiOptionsCard - carregar", () => {
  it("mostra os valores atuais e o padrao de cada opcao", async () => {
    await abrir({ ...PADRAO, retention_days: 7, daily_question_limit: 10, openrouter_monthly_budget_usd: 25.5 });

    expect(campo("Dias de guarda do historico").value).toBe("7");
    expect(campo("Perguntas por pessoa por dia").value).toBe("10");
    expect(campo("Orcamento mensal do OpenRouter").value).toBe("25.5");
    expect(screen.getAllByText(/Padrao: 30\./).length).toBe(1);
    expect(screen.getAllByText(/Padrao: 50\./).length).toBe(1);
  });

  it("sem orcamento o campo vem em branco", async () => {
    await abrir();

    expect(campo("Orcamento mensal do OpenRouter").value).toBe("");
  });

  it("avisa quando nao consegue carregar", async () => {
    get.mockRejectedValue(new Error("403"));
    render(<AiOptionsCard />);

    expect(await screen.findByText("Nao foi possivel carregar as opcoes do chat.")).toBeTruthy();
  });
});

describe("AiOptionsCard - salvar", () => {
  it("envia os tres valores como numeros e avisa que salvou", async () => {
    await abrir();
    fireEvent.change(campo("Dias de guarda do historico"), { target: { value: "14" } });
    fireEvent.change(campo("Perguntas por pessoa por dia"), { target: { value: "20" } });
    fireEvent.change(campo("Orcamento mensal do OpenRouter"), { target: { value: "12.5" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({
      retention_days: 14,
      daily_question_limit: 20,
      openrouter_monthly_budget_usd: 12.5,
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Opcoes do chat salvas."));
  });

  it("limite zero e enviado: quer dizer sem limite", async () => {
    await abrir();
    fireEvent.change(campo("Perguntas por pessoa por dia"), { target: { value: "0" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].daily_question_limit).toBe(0);
  });

  it("orcamento em branco manda zero e tira o orcamento", async () => {
    await abrir({ ...PADRAO, openrouter_monthly_budget_usd: 10 });
    fireEvent.change(campo("Orcamento mensal do OpenRouter"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].openrouter_monthly_budget_usd).toBe(0);
  });

  it("campo de dias ou de limite em branco nao vai no pedido", async () => {
    await abrir();
    fireEvent.change(campo("Dias de guarda do historico"), { target: { value: "" } });
    fireEvent.change(campo("Perguntas por pessoa por dia"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).not.toHaveProperty("retention_days");
    expect(update.mock.calls[0][0]).not.toHaveProperty("daily_question_limit");
  });

  it("mostra o que o servidor devolveu depois de salvar", async () => {
    update.mockResolvedValue({ ...PADRAO, retention_days: 90, openrouter_monthly_budget_usd: 5 });
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    await waitFor(() => expect(campo("Dias de guarda do historico").value).toBe("90"));
    expect(campo("Orcamento mensal do OpenRouter").value).toBe("5");
  });

  it("mostra o motivo quando o servidor recusa", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Valor fora do intervalo" } } });
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Salvar opcoes" }));

    expect(await screen.findByText("Valor fora do intervalo")).toBeTruthy();
  });
});
