import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiApi from "../api/aiSettings";
import AiModelPicker from "./AiModelPicker";

vi.mock("../api/aiSettings", () => ({ listAIProviderModels: vi.fn() }));

const listModels = vi.mocked(aiApi.listAIProviderModels);

interface Props {
  keyConfigured?: boolean;
  initial?: string;
  initialModels?: string[];
  onChange?: (value: string) => void;
}

// Guarda valor e lista como o AiTab faz, para o componente poder ser exercitado de verdade
function Wrapper({ keyConfigured = true, initial = "", initialModels, onChange }: Props) {
  const [value, setValue] = useState(initial);
  const [models, setModels] = useState<string[] | undefined>(initialModels);
  return (
    <AiModelPicker
      provider="openai"
      keyConfigured={keyConfigured}
      example="gpt-exemplo"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      models={models}
      onModelsLoaded={(_, list) => setModels(list)}
    />
  );
}

const muitos = (n: number) => Array.from({ length: n }, (_, i) => `modelo-${String(i).padStart(2, "0")}`);

beforeEach(() => {
  listModels.mockReset();
});

describe("AiModelPicker - sem chave", () => {
  it("mostra o campo de texto com o exemplo, avisa para salvar a chave e nao consulta o provedor", () => {
    render(<Wrapper keyConfigured={false} />);

    expect((screen.getByLabelText("Modelo") as HTMLInputElement).placeholder).toBe("Ex.: gpt-exemplo");
    expect(screen.getByText("Salve a chave para carregar a lista de modelos do provedor.")).toBeTruthy();
    expect(listModels).not.toHaveBeenCalled();
  });

  it("o texto digitado vai para quem usa", () => {
    const onChange = vi.fn();
    render(<Wrapper keyConfigured={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "meu-modelo" } });

    expect(onChange).toHaveBeenCalledWith("meu-modelo");
  });
});

describe("AiModelPicker - lista", () => {
  it("com chave salva carrega a lista e mostra uma lista suspensa", async () => {
    listModels.mockResolvedValue(["gpt-a", "gpt-b"]);
    render(<Wrapper />);

    expect(screen.getByText("Carregando modelos...")).toBeTruthy();
    expect(await screen.findByText("2 modelos disponiveis.")).toBeTruthy();
    expect(listModels).toHaveBeenCalledWith("openai");
    const lista = screen.getByLabelText("Modelo") as HTMLSelectElement;
    expect(lista.tagName).toBe("SELECT");
    expect(Array.from(lista.options).map((o) => o.value)).toEqual(["", "gpt-a", "gpt-b", "__outro__"]);
  });

  it("escolher na lista avisa quem usa e mostra o escolhido", async () => {
    listModels.mockResolvedValue(["gpt-a", "gpt-b"]);
    const onChange = vi.fn();
    render(<Wrapper onChange={onChange} />);
    await screen.findByText("2 modelos disponiveis.");

    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-b" } });

    expect(onChange).toHaveBeenCalledWith("gpt-b");
    expect((screen.getByLabelText("Modelo") as HTMLSelectElement).value).toBe("gpt-b");
  });

  it("o modelo salvo que o provedor nao lista mais continua na lista, marcado", async () => {
    listModels.mockResolvedValue(["gpt-a"]);
    render(<Wrapper initial="gpt-velho" />);
    await screen.findByText("1 modelo disponivel.");

    const lista = screen.getByLabelText("Modelo") as HTMLSelectElement;
    expect(lista.value).toBe("gpt-velho");
    expect(screen.getByRole("option", { name: "gpt-velho (salvo, fora da lista)" })).toBeTruthy();
  });

  it("usa a lista que ja existe, sem consultar de novo", () => {
    render(<Wrapper initialModels={["gpt-a"]} />);

    expect((screen.getByLabelText("Modelo") as HTMLSelectElement).tagName).toBe("SELECT");
    expect(listModels).not.toHaveBeenCalled();
  });

  it("Atualizar lista consulta de novo", async () => {
    listModels.mockResolvedValueOnce(["gpt-a"]).mockResolvedValueOnce(["gpt-a", "gpt-novo"]);
    render(<Wrapper />);
    await screen.findByText("1 modelo disponivel.");

    fireEvent.click(screen.getByRole("button", { name: "Atualizar lista" }));

    expect(await screen.findByText("2 modelos disponiveis.")).toBeTruthy();
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});

describe("AiModelPicker - filtro", () => {
  it("so aparece quando a lista e comprida e filtra mantendo o modelo escolhido", async () => {
    listModels.mockResolvedValue(muitos(20));
    render(<Wrapper initial="modelo-19" />);
    await screen.findByText("20 modelos disponiveis.");

    fireEvent.change(screen.getByLabelText("Filtrar modelos"), { target: { value: "modelo-0" } });

    const valores = Array.from((screen.getByLabelText("Modelo") as HTMLSelectElement).options).map((o) => o.value);
    expect(valores).toContain("modelo-03");
    expect(valores).not.toContain("modelo-12");
    expect(valores).toContain("modelo-19");
  });

  it("lista curta nao tem filtro", async () => {
    listModels.mockResolvedValue(muitos(5));
    render(<Wrapper />);
    await screen.findByText("5 modelos disponiveis.");

    expect(screen.queryByLabelText("Filtrar modelos")).toBeNull();
  });
});

describe("AiModelPicker - outro modelo", () => {
  it("Outro vira campo de texto sem perder o valor, e da para voltar para a lista", async () => {
    listModels.mockResolvedValue(["gpt-a"]);
    render(<Wrapper initial="gpt-a" />);
    await screen.findByText("1 modelo disponivel.");

    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "__outro__" } });

    const campo = screen.getByLabelText("Modelo") as HTMLInputElement;
    expect(campo.tagName).toBe("INPUT");
    expect(campo.value).toBe("gpt-a");

    fireEvent.click(screen.getByRole("button", { name: "Voltar para a lista" }));
    expect((screen.getByLabelText("Modelo") as HTMLSelectElement).tagName).toBe("SELECT");
  });
});

describe("AiModelPicker - falha", () => {
  it("mostra o motivo, deixa digitar o modelo e tenta de novo sob pedido", async () => {
    listModels
      .mockRejectedValueOnce({ response: { data: { detail: "O provedor recusou a chave de API." } } })
      .mockResolvedValueOnce(["gpt-a"]);
    render(<Wrapper />);

    expect(await screen.findByText("O provedor recusou a chave de API.")).toBeTruthy();
    expect((screen.getByLabelText("Modelo") as HTMLInputElement).tagName).toBe("INPUT");
    expect(listModels).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("1 modelo disponivel.")).toBeTruthy();
    expect(screen.queryByText("O provedor recusou a chave de API.")).toBeNull();
  });

  it("sem motivo do servidor usa uma mensagem padrao, sem repetir a consulta em laco", async () => {
    listModels.mockRejectedValue(new Error("rede"));
    render(<Wrapper />);

    expect(await screen.findByText("Nao foi possivel carregar a lista de modelos.")).toBeTruthy();
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
  });
});
