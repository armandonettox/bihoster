import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiApi from "../../api/aiSettings";
import type { AIProvider } from "../../api/aiSettings";
import AiTab from "./AiTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../api/aiSettings", () => ({
  listAIProviders: vi.fn(),
  updateAIProvider: vi.fn(),
  testAIProvider: vi.fn(),
}));

const list = vi.mocked(aiApi.listAIProviders);
const update = vi.mocked(aiApi.updateAIProvider);
const test = vi.mocked(aiApi.testAIProvider);

function provedor(chave: string, label: string, extra: Partial<AIProvider> = {}): AIProvider {
  return {
    provider: chave,
    label,
    example_model: `exemplo-${chave}`,
    api_key_configured: false,
    model: null,
    enabled: false,
    chat_default: false,
    ...extra,
  };
}

const VAZIOS: AIProvider[] = [
  provedor("openai", "OpenAI (ChatGPT)"),
  provedor("anthropic", "Anthropic (Claude)"),
  provedor("openrouter", "OpenRouter"),
];

async function abrir(dados: AIProvider[] = VAZIOS) {
  list.mockResolvedValue(dados);
  render(<AiTab />);
  await screen.findByText("Provedores de IA");
}

const cartao = (nome: string) => within(screen.getByRole("region", { name: nome }));

beforeEach(() => {
  mocks.showToast.mockClear();
  update.mockReset();
  test.mockReset();
});

describe("AiTab - carregar", () => {
  it("mostra um cartao por provedor, com a sugestao de modelo", async () => {
    await abrir();

    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect((cartao("OpenAI (ChatGPT)").getByLabelText("Modelo") as HTMLInputElement).placeholder).toBe("Ex.: exemplo-openai");
  });

  it("a chave nunca aparece: so um aviso de que ja foi cadastrada", async () => {
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);

    const chave = cartao("OpenAI (ChatGPT)").getByLabelText("Chave de API") as HTMLInputElement;
    expect(chave.value).toBe("");
    expect(chave.placeholder).toMatch(/Ja cadastrada/);
    expect((cartao("OpenAI (ChatGPT)").getByLabelText("Modelo") as HTMLInputElement).value).toBe("gpt-x");
  });

  it("avisa quando nao consegue carregar", async () => {
    list.mockRejectedValue(new Error("403"));
    render(<AiTab />);

    expect(await screen.findByText("Nao foi possivel carregar as configuracoes de IA.")).toBeTruthy();
  });
});

describe("AiTab - salvar", () => {
  it("envia so o provedor do cartao, com a chave digitada, e avisa que salvou", async () => {
    update.mockResolvedValue(provedor("openrouter", "OpenRouter", { api_key_configured: true, model: "openai/gpt-4o-mini", enabled: true }));
    await abrir();
    const c = cartao("OpenRouter");
    fireEvent.change(c.getByLabelText("Chave de API"), { target: { value: " chave-123 " } });
    fireEvent.change(c.getByLabelText("Modelo"), { target: { value: "openai/gpt-4o-mini" } });
    fireEvent.click(c.getByLabelText("Provedor ativo"));

    fireEvent.click(c.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("openrouter", {
      api_key: "chave-123",
      model: "openai/gpt-4o-mini",
      enabled: true,
      chat_default: false,
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("OpenRouter salvo."));
  });

  it("depois de salvar o campo da chave volta vazio e o cartao passa a aceitar teste", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" }));
    await abrir();
    const c = cartao("OpenAI (ChatGPT)");
    fireEvent.change(c.getByLabelText("Chave de API"), { target: { value: "chave-123" } });
    fireEvent.change(c.getByLabelText("Modelo"), { target: { value: "gpt-x" } });

    fireEvent.click(c.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect((c.getByRole("button", { name: "Testar conexao" }) as HTMLButtonElement).disabled).toBe(false));
    expect((c.getByLabelText("Chave de API") as HTMLInputElement).value).toBe("");
  });

  it("deixar a chave em branco mantem a atual: o campo nem vai no pedido", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" }));
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);

    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).not.toHaveProperty("api_key");
  });

  it("apagar a chave salva manda texto vazio", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)"));
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);
    const c = cartao("OpenAI (ChatGPT)");

    fireEvent.click(c.getByLabelText("Apagar a chave salva"));
    fireEvent.click(c.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].api_key).toBe("");
  });

  it("modelo vazio vai como nulo, e nao como texto vazio", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)"));
    await abrir();

    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].model).toBeNull();
  });

  it("mostra o motivo quando o servidor recusa, so no cartao certo", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Informe a chave e o modelo antes de ativar o provedor." } } });
    await abrir();

    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));

    expect(await cartao("OpenAI (ChatGPT)").findByText("Informe a chave e o modelo antes de ativar o provedor.")).toBeTruthy();
    expect(cartao("OpenRouter").queryByText("Informe a chave e o modelo antes de ativar o provedor.")).toBeNull();
  });
});

describe("AiTab - provedor do chat", () => {
  const ATIVO = (chave: string, label: string, extra: Partial<AIProvider> = {}) =>
    provedor(chave, label, { api_key_configured: true, model: "m", enabled: true, ...extra });

  const usarNoChat = (nome: string) => cartao(nome).getByLabelText("Usar este provedor no chat") as HTMLInputElement;

  it("a caixa vem travada, com aviso, enquanto o provedor nao esta ativo", async () => {
    await abrir();

    expect(usarNoChat("OpenAI (ChatGPT)").disabled).toBe(true);
    expect(cartao("OpenAI (ChatGPT)").getByText("Ative o provedor para poder escolhe-lo para o chat.")).toBeTruthy();
  });

  it("mostra marcado so o provedor que o servidor diz que responde o chat", async () => {
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)"), ATIVO("anthropic", "Anthropic (Claude)", { chat_default: true })]);

    expect(usarNoChat("OpenAI (ChatGPT)").checked).toBe(false);
    expect(usarNoChat("Anthropic (Claude)").checked).toBe(true);
  });

  it("marcar a caixa envia chat_default verdadeiro", async () => {
    update.mockResolvedValue(ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)")]);

    fireEvent.click(usarNoChat("OpenAI (ChatGPT)"));
    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].chat_default).toBe(true);
  });

  it("desativar o provedor desmarca e trava a caixa, e manda chat_default falso", async () => {
    update.mockResolvedValue(ATIVO("openai", "OpenAI (ChatGPT)", { enabled: false }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true })]);

    fireEvent.click(cartao("OpenAI (ChatGPT)").getByLabelText("Provedor ativo"));

    expect(usarNoChat("OpenAI (ChatGPT)").checked).toBe(false);
    expect(usarNoChat("OpenAI (ChatGPT)").disabled).toBe(true);
    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ enabled: false, chat_default: false });
  });

  it("quando outro provedor vira o escolhido, o antigo desmarca sozinho", async () => {
    update.mockResolvedValue(ATIVO("anthropic", "Anthropic (Claude)", { chat_default: true }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true }), ATIVO("anthropic", "Anthropic (Claude)")]);
    expect(usarNoChat("OpenAI (ChatGPT)").checked).toBe(true);

    fireEvent.click(usarNoChat("Anthropic (Claude)"));
    fireEvent.click(cartao("Anthropic (Claude)").getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(usarNoChat("OpenAI (ChatGPT)").checked).toBe(false));
    expect(usarNoChat("Anthropic (Claude)").checked).toBe(true);
  });

  it("mostra o motivo quando o servidor recusa a escolha", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Ative o provedor antes de escolhe-lo para o chat." } } });
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)")]);

    fireEvent.click(usarNoChat("OpenAI (ChatGPT)"));
    fireEvent.click(cartao("OpenAI (ChatGPT)").getByRole("button", { name: "Salvar" }));

    expect(await cartao("OpenAI (ChatGPT)").findByText("Ative o provedor antes de escolhe-lo para o chat.")).toBeTruthy();
  });
});

describe("AiTab - testar conexao", () => {
  const SALVO = provedor("anthropic", "Anthropic (Claude)", { api_key_configured: true, model: "claude-x" });

  it("so testa depois de salvar a chave e o modelo", async () => {
    await abrir();

    const c = cartao("Anthropic (Claude)");
    expect((c.getByRole("button", { name: "Testar conexao" }) as HTMLButtonElement).disabled).toBe(true);
    expect(c.getByText("Salve a chave e o modelo para poder testar.")).toBeTruthy();
  });

  it("testa o provedor do cartao e confirma com modelo e tempo", async () => {
    test.mockResolvedValue({ ok: true, model: "claude-x", latency_ms: 420 });
    await abrir([SALVO]);

    fireEvent.click(cartao("Anthropic (Claude)").getByRole("button", { name: "Testar conexao" }));

    expect(await screen.findByText("Conexao ok com o modelo claude-x (420 ms).")).toBeTruthy();
    expect(test).toHaveBeenCalledWith("anthropic");
  });

  it("mostra o motivo da falha (chave recusada, modelo errado...)", async () => {
    test.mockRejectedValue({ response: { data: { detail: "O provedor recusou a chave de API. Confira se ela esta correta e ativa." } } });
    await abrir([SALVO]);

    fireEvent.click(cartao("Anthropic (Claude)").getByRole("button", { name: "Testar conexao" }));

    expect(await screen.findByText(/O provedor recusou a chave de API/)).toBeTruthy();
  });
});
