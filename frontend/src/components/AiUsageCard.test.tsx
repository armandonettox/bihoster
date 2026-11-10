import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/aiChat";
import type { AIUsageSummary } from "../api/aiChat";
import AiUsageCard from "./AiUsageCard";

vi.mock("../api/aiChat", () => ({ getAIUsage: vi.fn() }));

const getUsage = vi.mocked(chatApi.getAIUsage);

const totais = (extra = {}) => ({
  questions: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, unpriced_questions: 0, ...extra,
});

function resumo(extra: Partial<AIUsageSummary> = {}): AIUsageSummary {
  return {
    period_days: 30,
    totals: totais({ questions: 3, input_tokens: 72, output_tokens: 24, cost_usd: 0.00012 }),
    by_user: [
      { ...totais({ questions: 2, input_tokens: 48, output_tokens: 16, cost_usd: 0.00008 }), user_id: 1, email: "ana@example.com" },
      { ...totais({ questions: 1, input_tokens: 24, output_tokens: 8, cost_usd: 0.00004 }), user_id: null, email: null },
    ],
    by_model: [
      { ...totais({ questions: 2, cost_usd: 0.00012 }), provider: "openrouter", model: "modelo-x" },
      { ...totais({ questions: 1 }), provider: "gemini", model: "gem-1" },
    ],
    daily_limit: 50,
    openrouter_budget: { monthly_usd: null, spent_month_usd: 0.00012, remaining_usd: null, blocked: false, unpriced_questions_month: 0 },
    ...extra,
  };
}

beforeEach(() => {
  getUsage.mockReset();
});

describe("AiUsageCard", () => {
  it("carrega os ultimos 30 dias e mostra os totais", async () => {
    getUsage.mockResolvedValue(resumo());
    render(<AiUsageCard />);

    expect(await screen.findByText("Perguntas:")).toBeTruthy();
    expect(getUsage).toHaveBeenCalledWith(30);
    expect(screen.getByText("72")).toBeTruthy();
    // O custo total aparece no resumo e tambem na linha do modelo
    expect(screen.getAllByText("US$ 0,00012").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("50 perguntas por dia")).toBeTruthy();
  });

  it("limite zero aparece como sem limite", async () => {
    getUsage.mockResolvedValue(resumo({ daily_limit: 0 }));
    render(<AiUsageCard />);

    expect(await screen.findByText("sem limite")).toBeTruthy();
  });

  it("lista por pessoa, com conta excluida quando nao ha e-mail", async () => {
    getUsage.mockResolvedValue(resumo());
    render(<AiUsageCard />);
    await screen.findByText("Perguntas:");

    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Conta excluida")).toBeTruthy();
  });

  it("custo por modelo so aparece para o OpenRouter", async () => {
    getUsage.mockResolvedValue(resumo());
    render(<AiUsageCard />);
    await screen.findByText("Perguntas:");

    const linhas = screen.getAllByRole("row");
    const gemini = linhas.find((linha) => within(linha).queryByText("gem-1"));
    expect(within(gemini as HTMLElement).getByText("-")).toBeTruthy();
    const openrouter = linhas.find((linha) => within(linha).queryByText("modelo-x"));
    expect(within(openrouter as HTMLElement).getByText("US$ 0,00012")).toBeTruthy();
  });

  it("sem orcamento mostra so o gasto do mes", async () => {
    getUsage.mockResolvedValue(resumo());
    render(<AiUsageCard />);

    expect(await screen.findByText(/Sem orcamento definido\. Gasto no mes: US\$ 0,00012\./)).toBeTruthy();
  });

  it("com orcamento mostra gasto, limite e o que resta", async () => {
    getUsage.mockResolvedValue(
      resumo({ openrouter_budget: { monthly_usd: 10, spent_month_usd: 2.5, remaining_usd: 7.5, blocked: false, unpriced_questions_month: 0 } }),
    );
    render(<AiUsageCard />);

    expect(await screen.findByText(/Gasto no mes: US\$ 2,50 de US\$ 10,00 \(restam US\$ 7,50\)/)).toBeTruthy();
    expect(screen.queryByText(/Orcamento atingido/)).toBeNull();
  });

  it("orcamento estourado vem como aviso", async () => {
    getUsage.mockResolvedValue(
      resumo({ openrouter_budget: { monthly_usd: 10, spent_month_usd: 10.2, remaining_usd: 0, blocked: true, unpriced_questions_month: 0 } }),
    );
    render(<AiUsageCard />);

    expect((await screen.findByText(/Orcamento atingido/)).className).toContain("auth-error");
  });

  it("avisa das perguntas do OpenRouter sem preco", async () => {
    getUsage.mockResolvedValue(resumo({ totals: totais({ questions: 3, unpriced_questions: 2 }) }));
    render(<AiUsageCard />);

    expect(await screen.findByText(/2 pergunta\(s\) do OpenRouter ficaram sem preco/)).toBeTruthy();
  });

  it("trocar o periodo busca de novo e mostra Carregando ate chegar", async () => {
    getUsage.mockResolvedValueOnce(resumo()).mockResolvedValueOnce(resumo({ period_days: 7 }));
    render(<AiUsageCard />);
    await screen.findByText("Perguntas:");

    fireEvent.change(screen.getByLabelText("Periodo"), { target: { value: "7" } });

    expect(screen.getByText("Carregando...")).toBeTruthy();
    await waitFor(() => expect(getUsage).toHaveBeenLastCalledWith(7));
    expect(await screen.findByText("Perguntas:")).toBeTruthy();
  });

  it("sem perguntas no periodo diz isso nas duas listas", async () => {
    getUsage.mockResolvedValue(resumo({ by_user: [], by_model: [] }));
    render(<AiUsageCard />);
    await screen.findByText("Perguntas:");

    expect(screen.getAllByText("Nenhuma pergunta no periodo.")).toHaveLength(2);
  });

  it("avisa quando nao consegue carregar", async () => {
    getUsage.mockRejectedValue(new Error("403"));
    render(<AiUsageCard />);

    expect(await screen.findByText("Nao foi possivel carregar o consumo.")).toBeTruthy();
  });
});
