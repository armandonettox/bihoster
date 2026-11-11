import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiApi from "../../api/aiSettings";
import type { AIProvider } from "../../api/aiSettings";
import AiTab from "./AiTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
// O bloco de opcoes do chat e o de consumo tem teste proprio; aqui so interessa o provedor
vi.mock("../../components/AiOptionsCard", () => ({ default: () => null }));
vi.mock("../../components/AiReportCard", () => ({ default: () => null }));
vi.mock("../../components/AiLogCard", () => ({ default: () => null }));
vi.mock("../../components/AiUsageCard", () => ({ default: () => null }));
vi.mock("../../api/aiSettings", () => ({
  listAIProviders: vi.fn(),
  updateAIProvider: vi.fn(),
  testAIProvider: vi.fn(),
  listAIProviderModels: vi.fn(),
}));

const list = vi.mocked(aiApi.listAIProviders);
const update = vi.mocked(aiApi.updateAIProvider);
const test = vi.mocked(aiApi.testAIProvider);
const listModels = vi.mocked(aiApi.listAIProviderModels);

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
  await screen.findByRole("heading", { name: "Provedor de IA" });
}

const escolher = (chave: string) => fireEvent.change(screen.getByLabelText("Provedor"), { target: { value: chave } });
const salvar = () => fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
const selecionado = () => (screen.getByLabelText("Provedor") as HTMLSelectElement).value;

beforeEach(() => {
  mocks.showToast.mockClear();
  update.mockReset();
  test.mockReset();
  listModels.mockReset();
  listModels.mockResolvedValue(["modelo-a", "modelo-b"]);
});

describe("AiTab - lista de provedores", () => {
  it("tem uma lista suspensa com todos os provedores e o estado de cada um", async () => {
    await abrir([
      provedor("openai", "OpenAI (ChatGPT)"),
      provedor("anthropic", "Anthropic (Claude)", { api_key_configured: true }),
      provedor("openrouter", "OpenRouter", { api_key_configured: true, model: "m", enabled: true }),
      provedor("gemini", "Google Gemini", { api_key_configured: true, model: "m", enabled: true, chat_default: true }),
    ]);

    const opcoes = Array.from((screen.getByLabelText("Provedor") as HTMLSelectElement).options).map((o) => o.text);
    expect(opcoes).toEqual([
      "OpenAI (ChatGPT) (sem chave)",
      "Anthropic (Claude) (chave salva, inativo)",
      "OpenRouter (ativo)",
      "Google Gemini (ativo, padrao do chat)",
    ]);
  });

  it("mostra so o formulario do provedor escolhido, e trocar mostra o do outro", async () => {
    await abrir();

    expect(screen.getAllByLabelText("Chave de API")).toHaveLength(1);
    expect(screen.getByRole("form", { name: "OpenAI (ChatGPT)" })).toBeTruthy();

    escolher("anthropic");

    expect(screen.getAllByLabelText("Chave de API")).toHaveLength(1);
    expect(screen.getByRole("form", { name: "Anthropic (Claude)" })).toBeTruthy();
  });

  it("comeca no provedor que responde o chat", async () => {
    await abrir([
      provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "m", enabled: true }),
      provedor("anthropic", "Anthropic (Claude)", { api_key_configured: true, model: "m", enabled: true, chat_default: true }),
    ]);

    expect(selecionado()).toBe("anthropic");
  });

  it("sem provedor do chat, comeca no primeiro ativo", async () => {
    await abrir([
      provedor("openai", "OpenAI (ChatGPT)"),
      provedor("anthropic", "Anthropic (Claude)", { api_key_configured: true, model: "m", enabled: true }),
    ]);

    expect(selecionado()).toBe("anthropic");
  });

  it("sem nenhum ativo, comeca no primeiro da lista", async () => {
    await abrir();

    expect(selecionado()).toBe("openai");
  });

  it("avisa quando nao consegue carregar", async () => {
    list.mockRejectedValue(new Error("403"));
    render(<AiTab />);

    expect(await screen.findByText("Nao foi possivel carregar as configuracoes de IA.")).toBeTruthy();
  });
});

describe("AiTab - carregar", () => {
  it("sem chave, o modelo e um campo de texto com a sugestao", async () => {
    await abrir();

    expect((screen.getByLabelText("Modelo") as HTMLInputElement).placeholder).toBe("Ex.: exemplo-openai");
  });

  it("a chave nunca aparece: so um aviso de que ja foi cadastrada", async () => {
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);

    const chave = screen.getByLabelText("Chave de API") as HTMLInputElement;
    expect(chave.value).toBe("");
    expect(chave.placeholder).toMatch(/Ja cadastrada/);
  });
});

describe("AiTab - lista de modelos", () => {
  const COM_CHAVE = [
    provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "modelo-b" }),
    provedor("anthropic", "Anthropic (Claude)"),
  ];

  it("com chave salva, o modelo vira uma lista suspensa com o modelo salvo escolhido", async () => {
    await abrir(COM_CHAVE);

    await screen.findByText("2 modelos disponiveis.");
    expect(listModels).toHaveBeenCalledWith("openai");
    const lista = screen.getByLabelText("Modelo") as HTMLSelectElement;
    expect(lista.tagName).toBe("SELECT");
    expect(lista.value).toBe("modelo-b");
  });

  it("trocar de provedor e voltar nao consulta a lista de novo", async () => {
    await abrir(COM_CHAVE);
    await screen.findByText("2 modelos disponiveis.");

    escolher("anthropic");
    escolher("openai");

    expect(await screen.findByText("2 modelos disponiveis.")).toBeTruthy();
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("salvar uma chave nova descarta a lista e consulta de novo com a chave nova", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "modelo-b" }));
    await abrir(COM_CHAVE);
    await screen.findByText("2 modelos disponiveis.");

    fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value: "chave-nova" } });
    salvar();

    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));
  });

  it("salvar sem mexer na chave mantem a lista", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "modelo-a" }));
    await abrir(COM_CHAVE);
    await screen.findByText("2 modelos disponiveis.");

    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "modelo-a" } });
    salvar();

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ model: "modelo-a" });
    await screen.findByText("2 modelos disponiveis.");
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("cadastrar a primeira chave passa a carregar a lista", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true }));
    await abrir();
    expect(listModels).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value: "chave-123" } });
    salvar();

    expect(await screen.findByText("2 modelos disponiveis.")).toBeTruthy();
    expect(listModels).toHaveBeenCalledWith("openai");
  });
});

describe("AiTab - salvar", () => {
  it("envia o provedor escolhido, com a chave digitada, e avisa que salvou", async () => {
    update.mockResolvedValue(provedor("openrouter", "OpenRouter", { api_key_configured: true, model: "openai/gpt-4o-mini", enabled: true }));
    await abrir();
    escolher("openrouter");
    fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value: " chave-123 " } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "openai/gpt-4o-mini" } });
    fireEvent.click(screen.getByLabelText("Provedor ativo"));

    salvar();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("openrouter", {
      api_key: "chave-123",
      model: "openai/gpt-4o-mini",
      enabled: true,
      chat_default: false,
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("OpenRouter salvo."));
  });

  it("depois de salvar, o estado do provedor na lista suspensa se atualiza", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x", enabled: true }));
    await abrir();
    fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value: "chave-123" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-x" } });
    fireEvent.click(screen.getByLabelText("Provedor ativo"));

    salvar();

    expect(await screen.findByRole("option", { name: "OpenAI (ChatGPT) (ativo)" })).toBeTruthy();
  });

  it("depois de salvar o campo da chave volta vazio e o provedor passa a aceitar teste", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" }));
    await abrir();
    fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value: "chave-123" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-x" } });

    salvar();

    await waitFor(() => expect((screen.getByRole("button", { name: "Testar conexao" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Chave de API") as HTMLInputElement).value).toBe("");
  });

  it("deixar a chave em branco mantem a atual: o campo nem vai no pedido", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" }));
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);

    salvar();

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).not.toHaveProperty("api_key");
  });

  it("apagar a chave salva manda texto vazio", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)"));
    await abrir([provedor("openai", "OpenAI (ChatGPT)", { api_key_configured: true, model: "gpt-x" })]);

    fireEvent.click(screen.getByLabelText("Apagar a chave salva"));
    salvar();

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].api_key).toBe("");
  });

  it("modelo vazio vai como nulo, e nao como texto vazio", async () => {
    update.mockResolvedValue(provedor("openai", "OpenAI (ChatGPT)"));
    await abrir();

    salvar();

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].model).toBeNull();
  });

  it("mostra o motivo quando o servidor recusa, so no provedor em tela", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Informe a chave e o modelo antes de ativar o provedor." } } });
    await abrir();

    salvar();

    expect(await screen.findByText("Informe a chave e o modelo antes de ativar o provedor.")).toBeTruthy();
    escolher("openrouter");
    expect(screen.queryByText("Informe a chave e o modelo antes de ativar o provedor.")).toBeNull();
  });
});

describe("AiTab - provedor do chat", () => {
  const ATIVO = (chave: string, label: string, extra: Partial<AIProvider> = {}) =>
    provedor(chave, label, { api_key_configured: true, model: "m", enabled: true, ...extra });

  const usarNoChat = () => screen.getByLabelText("Usar este provedor no chat") as HTMLInputElement;

  it("a caixa vem travada, com aviso, enquanto o provedor nao esta ativo", async () => {
    await abrir();

    expect(usarNoChat().disabled).toBe(true);
    expect(screen.getByText("Ative o provedor para poder escolhe-lo para o chat.")).toBeTruthy();
  });

  it("mostra marcado so o provedor que o servidor diz que responde o chat", async () => {
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)"), ATIVO("anthropic", "Anthropic (Claude)", { chat_default: true })]);

    expect(usarNoChat().checked).toBe(true);
    escolher("openai");
    expect(usarNoChat().checked).toBe(false);
  });

  it("marcar a caixa envia chat_default verdadeiro", async () => {
    update.mockResolvedValue(ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)")]);

    fireEvent.click(usarNoChat());
    salvar();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].chat_default).toBe(true);
  });

  it("desativar o provedor desmarca e trava a caixa, e manda chat_default falso", async () => {
    update.mockResolvedValue(ATIVO("openai", "OpenAI (ChatGPT)", { enabled: false }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true })]);

    fireEvent.click(screen.getByLabelText("Provedor ativo"));

    expect(usarNoChat().checked).toBe(false);
    expect(usarNoChat().disabled).toBe(true);
    salvar();
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ enabled: false, chat_default: false });
  });

  it("quando outro provedor vira o escolhido, o antigo desmarca sozinho", async () => {
    update.mockResolvedValue(ATIVO("anthropic", "Anthropic (Claude)", { chat_default: true }));
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)", { chat_default: true }), ATIVO("anthropic", "Anthropic (Claude)")]);
    escolher("anthropic");

    fireEvent.click(usarNoChat());
    salvar();

    await waitFor(() => expect(screen.getByRole("option", { name: "OpenAI (ChatGPT) (ativo)" })).toBeTruthy());
    escolher("openai");
    expect(usarNoChat().checked).toBe(false);
    escolher("anthropic");
    expect(usarNoChat().checked).toBe(true);
  });

  it("mostra o motivo quando o servidor recusa a escolha", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Ative o provedor antes de escolhe-lo para o chat." } } });
    await abrir([ATIVO("openai", "OpenAI (ChatGPT)")]);

    fireEvent.click(usarNoChat());
    salvar();

    expect(await screen.findByText("Ative o provedor antes de escolhe-lo para o chat.")).toBeTruthy();
  });
});

describe("AiTab - testar conexao", () => {
  const SALVO = provedor("anthropic", "Anthropic (Claude)", { api_key_configured: true, model: "claude-x" });

  it("so testa depois de salvar a chave e o modelo", async () => {
    await abrir();

    expect((screen.getByRole("button", { name: "Testar conexao" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Salve a chave e o modelo para poder testar.")).toBeTruthy();
  });

  it("testa o provedor em tela e confirma com modelo e tempo", async () => {
    test.mockResolvedValue({ ok: true, model: "claude-x", latency_ms: 420 });
    await abrir([SALVO]);

    fireEvent.click(screen.getByRole("button", { name: "Testar conexao" }));

    expect(await screen.findByText("Conexao ok com o modelo claude-x (420 ms).")).toBeTruthy();
    expect(test).toHaveBeenCalledWith("anthropic");
  });

  it("mostra o motivo da falha (chave recusada, modelo errado...)", async () => {
    test.mockRejectedValue({ response: { data: { detail: "O provedor recusou a chave de API. Confira se ela esta correta e ativa." } } });
    await abrir([SALVO]);

    fireEvent.click(screen.getByRole("button", { name: "Testar conexao" }));

    expect(await screen.findByText(/O provedor recusou a chave de API/)).toBeTruthy();
  });
});
