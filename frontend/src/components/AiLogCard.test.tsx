import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiLogApi from "../api/aiLog";
import type { AILog, AILogEntry } from "../api/aiLog";
import AiLogCard from "./AiLogCard";

vi.mock("../api/aiLog", () => ({ getAILog: vi.fn() }));

const getLog = vi.mocked(aiLogApi.getAILog);

function entrada(parcial: Partial<AILogEntry> = {}): AILogEntry {
  return {
    id: 1,
    created_at: "2026-11-10T14:30:00Z",
    user_email: "ana@example.com",
    conversation_id: 3,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-pro",
    report_name: "Carteira",
    outcome: "answered",
    error: null,
    duration_ms: 8200,
    llm_calls: 2,
    input_tokens: 1200,
    output_tokens: 80,
    used_image: false,
    question: "quantas vidas ativas?",
    reply: "Sao 19.768 vidas ativas.",
    dax: 'EVALUATE ROW("t", [Vidas Ativas])',
    steps: [
      { step: "ler_esquema", ms: 300 },
      {
        step: "gerar_consulta",
        ms: 5000,
        max_tokens: 2500,
        input_tokens: 1000,
        output_tokens: 50,
        reasoning_tokens: 0,
        finish_reason: "stop",
        text_chars: 40,
        json_ok: true,
      },
      { step: "power_bi", ms: 900, rows: 1 },
    ],
    ...parcial,
  };
}

function registro(parcial: Partial<AILog> = {}): AILog {
  return {
    days: 7,
    retention_days: 30,
    entries: [entrada()],
    next_before_id: null,
    by_model: [{ provider: "openrouter", model: "deepseek/deepseek-v4-pro", questions: 10, problems: 3, avg_ms: 8200, p95_ms: 21000 }],
    ...parcial,
  };
}

beforeEach(() => {
  getLog.mockReset();
  getLog.mockResolvedValue(registro());
});

describe("AiLogCard - resumo e lista", () => {
  it("carrega o periodo de 7 dias, sem filtro de problemas", async () => {
    render(<AiLogCard />);

    await screen.findByText("Respondeu");
    expect(getLog).toHaveBeenCalledWith({ days: 7, onlyProblems: false, beforeId: undefined });
  });

  it("mostra por modelo as perguntas, os problemas com a porcentagem e os tempos em segundos", async () => {
    render(<AiLogCard />);

    const linha = (await screen.findByText("deepseek/deepseek-v4-pro", { selector: "td" })).closest("tr")!;
    const celulas = within(linha).getAllByRole("cell").map((c) => c.textContent);
    expect(celulas).toEqual(["openrouter", "deepseek/deepseek-v4-pro", "10", "3 (30%)", "8,2 s", "21,0 s"]);
  });

  it("cada pergunta mostra o desfecho, quem perguntou, provedor, modelo e o tempo", async () => {
    render(<AiLogCard />);

    const resumo = (await screen.findByText("Respondeu")).closest("summary")!;
    expect(resumo.textContent).toContain("ana@example.com");
    expect(resumo.textContent).toContain("openrouter / deepseek/deepseek-v4-pro");
    expect(resumo.textContent).toContain("8,2 s");
    expect(resumo.textContent).toContain("quantas vidas ativas?");
  });

  it("abrir a pergunta mostra a resposta, o relatorio, os tokens, a consulta e os passos", async () => {
    render(<AiLogCard />);
    const resumo = (await screen.findByText("Respondeu")).closest("summary")!;

    const bloco = resumo.closest("details")!;
    expect(within(bloco).getByText("Sao 19.768 vidas ativas.", { exact: false })).toBeTruthy();
    expect(within(bloco).getByText(/Relatorio: Carteira - 2 chamadas a IA - 1.200 tokens de entrada e 80 de saida/)).toBeTruthy();
    expect(within(bloco).getByText('EVALUATE ROW("t", [Vidas Ativas])')).toBeTruthy();
    const passos = within(bloco).getAllByRole("row").map((r) => r.textContent);
    expect(passos.some((t) => t?.includes("Gerar a consulta") && t.includes("5,0 s") && t.includes("1.000 / 50") && t.includes("stop"))).toBe(true);
    expect(passos.some((t) => t?.includes("Consultar o Power BI") && t.includes("1 linhas"))).toBe(true);
  });

  it("falha mostra o erro e marca o passo com a causa: resposta vazia por limite de tokens", async () => {
    getLog.mockResolvedValue(
      registro({
        entries: [
          entrada({
            outcome: "error",
            error: "A IA devolveu uma resposta vazia.",
            reply: null,
            steps: [
              { step: "gerar_consulta", ms: 31000, max_tokens: 2500, input_tokens: 900, output_tokens: 2500, reasoning_tokens: 2500, finish_reason: "length", text_chars: 0, json_ok: false },
              { step: "gerar_consulta (nova tentativa)", ms: 40000, max_tokens: 5000, input_tokens: 900, output_tokens: 5000, reasoning_tokens: 5000, finish_reason: "length", text_chars: 0, json_ok: false },
            ],
          }),
        ],
      }),
    );
    render(<AiLogCard />);

    const bloco = (await screen.findByText("Erro")).closest("details")!;
    expect(bloco.className).toContain("ai-log-entry-problem");
    expect(within(bloco).getByText("A IA devolveu uma resposta vazia.", { exact: false })).toBeTruthy();
    expect(within(bloco).getByText("(sem resposta)", { exact: false })).toBeTruthy();
    const passos = within(bloco).getAllByRole("row").map((r) => r.textContent ?? "");
    expect(passos.some((t) => t.includes("Gerar a consulta (nova tentativa)") && t.includes("5.000") && t.includes("length") && t.includes("JSON invalido") && t.includes("resposta vazia"))).toBe(true);
  });

  it("pergunta respondida nao leva a marca de problema, e recusa padrao leva", async () => {
    getLog.mockResolvedValue(registro({ entries: [entrada({ id: 2 }), entrada({ id: 1, outcome: "off_topic", question: "esta errado" })] }));
    render(<AiLogCard />);

    const respondida = (await screen.findByText("Respondeu")).closest("details")!;
    const recusa = screen.getByText("Recusa padrao").closest("details")!;
    expect(respondida.className).not.toContain("problem");
    expect(recusa.className).toContain("ai-log-entry-problem");
  });

  it("desfecho que nao conhece aparece como veio", async () => {
    getLog.mockResolvedValue(registro({ entries: [entrada({ outcome: "outro_novo" })] }));
    render(<AiLogCard />);

    expect(await screen.findByText("outro_novo")).toBeTruthy();
  });

  it("pergunta com imagem avisa", async () => {
    getLog.mockResolvedValue(registro({ entries: [entrada({ used_image: true })] }));
    render(<AiLogCard />);

    expect(await screen.findByText(/com imagem da pagina/)).toBeTruthy();
  });

  it("sem registros diz que nao houve pergunta", async () => {
    getLog.mockResolvedValue(registro({ entries: [], by_model: [] }));
    render(<AiLogCard />);

    expect(await screen.findByText("Nenhuma pergunta no periodo.")).toBeTruthy();
  });

  it("explica o prazo, o que fica guardado e quem ve", async () => {
    render(<AiLogCard />);

    expect(await screen.findByText(/nunca as linhas das tabelas/)).toBeTruthy();
    expect(screen.getByText(/apaga sozinho depois de 30 dias/)).toBeTruthy();
    expect(screen.getByText(/So quem gerencia a IA ve esta lista/)).toBeTruthy();
  });
});

describe("AiLogCard - filtros e paginas", () => {
  it("trocar o periodo carrega de novo", async () => {
    render(<AiLogCard />);
    await screen.findByText("Respondeu");

    fireEvent.change(screen.getByLabelText("Periodo"), { target: { value: "30" } });

    await waitFor(() => expect(getLog).toHaveBeenLastCalledWith({ days: 30, onlyProblems: false, beforeId: undefined }));
  });

  it("so respostas com problema pede o filtro ao servidor e avisa quando nao ha nenhuma", async () => {
    render(<AiLogCard />);
    await screen.findByText("Respondeu");
    getLog.mockResolvedValue(registro({ entries: [] }));

    fireEvent.click(screen.getByLabelText("So respostas com problema"));

    await waitFor(() => expect(getLog).toHaveBeenLastCalledWith({ days: 7, onlyProblems: true, beforeId: undefined }));
    expect(await screen.findByText("Nenhuma resposta com problema no periodo.")).toBeTruthy();
  });

  it("Atualizar le de novo com o mesmo filtro", async () => {
    render(<AiLogCard />);
    await screen.findByText("Respondeu");

    fireEvent.click(screen.getByText("Atualizar"));

    await waitFor(() => expect(getLog).toHaveBeenCalledTimes(2));
  });

  it("Carregar mais acrescenta a proxima pagina, sem apagar a anterior, e some quando acaba", async () => {
    getLog.mockResolvedValueOnce(registro({ entries: [entrada({ id: 5, question: "primeira pagina" })], next_before_id: 5 }));
    render(<AiLogCard />);
    await screen.findAllByText(/primeira pagina/);
    getLog.mockResolvedValueOnce(registro({ entries: [entrada({ id: 4, question: "segunda pagina" })], next_before_id: null }));

    fireEvent.click(screen.getByText("Carregar mais"));

    await screen.findAllByText(/segunda pagina/);
    expect(getLog).toHaveBeenLastCalledWith({ days: 7, onlyProblems: false, beforeId: 5 });
    expect(screen.getAllByText(/primeira pagina/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Carregar mais")).toBeNull();
  });

  it("falha ao carregar mostra o motivo do servidor", async () => {
    getLog.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });
    render(<AiLogCard />);

    expect(await screen.findByText("Sem permissao")).toBeTruthy();
  });

  it("trocar o filtro descarta a lista antiga em vez de misturar", async () => {
    getLog.mockResolvedValueOnce(registro({ entries: [entrada({ id: 9, question: "so no filtro antigo" })] }));
    render(<AiLogCard />);
    await screen.findAllByText(/so no filtro antigo/);
    getLog.mockResolvedValueOnce(registro({ entries: [entrada({ id: 8, question: "so no filtro novo" })] }));

    fireEvent.click(screen.getByLabelText("So respostas com problema"));

    await screen.findAllByText(/so no filtro novo/);
    expect(screen.queryAllByText(/so no filtro antigo/)).toHaveLength(0);
  });
});
