import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as settingsApi from "../../api/settings";
import type { AppSettings } from "../../api/settings";
import BrandTab from "./BrandTab";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  settings: null as unknown,
  reload: vi.fn(),
}));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/BrandingContext", () => ({
  useBranding: () => ({ settings: mocks.settings, reload: mocks.reload }),
}));
vi.mock("../../api/settings", () => ({
  updateSettings: vi.fn(),
  uploadLogo: vi.fn(),
  removeLogo: vi.fn(),
  uploadFavicon: vi.fn(),
  removeFavicon: vi.fn(),
  uploadLoginImage: vi.fn(),
  removeLoginImage: vi.fn(),
}));
// As prévias têm o desenho da tela inteira: aqui só importa o que cada uma recebe
vi.mock("../../components/AppShellPreview", () => ({
  default: (props: { primaryColor: string; secondaryColor: string; scale?: number; label?: string | null; logoUrl: string | null }) => (
    <div
      data-testid="previa-sistema"
      data-primary={props.primaryColor}
      data-secondary={props.secondaryColor}
      data-scale={props.scale}
      data-label={String(props.label)}
      data-logo={props.logoUrl ?? ""}
    />
  ),
}));
vi.mock("../../components/LoginPreview", () => ({
  default: (props: {
    primaryColor: string;
    layout: string;
    loginImageUrl: string | null;
    scale?: number;
    label?: string | null;
  }) => (
    <div
      data-testid="previa-login"
      data-primary={props.primaryColor}
      data-layout={props.layout}
      data-image={props.loginImageUrl ?? ""}
      data-scale={props.scale}
      data-label={String(props.label)}
    />
  ),
}));
vi.mock("../../components/ErrorScreenPreview", () => ({
  default: (props: {
    kind: string;
    texts: { title: string; message: string; button: string };
    logoUrl: string | null;
    primaryColor: string;
    scale?: number;
  }) => (
    <div
      data-testid={`previa-erro-${props.kind}`}
      data-title={props.texts.title}
      data-message={props.texts.message}
      data-button={props.texts.button}
      data-primary={props.primaryColor}
      data-logo={props.logoUrl ?? ""}
      data-scale={props.scale}
    />
  ),
}));

const api = vi.mocked(settingsApi);

const BASE = {
  company_name: "BIHoster",
  primary_color: "#1E3A6B",
  secondary_color: "#5B9BD5",
  logo_url: null,
  favicon_url: null,
  login_image_url: null,
  login_layout: "centered",
  not_found_title: null,
  not_found_message: null,
  not_found_button: null,
  error_title: null,
  error_message: null,
  error_button: null,
} as unknown as AppSettings;

const primaria = () => screen.getByLabelText("Cor primária") as HTMLInputElement;
const secundaria = () => screen.getByLabelText("Cor secundária") as HTMLInputElement;
const salvar = () => screen.getByText("Salvar") as HTMLButtonElement;
const semBarra = () => expect(screen.queryByText("Salvar")).toBeNull();
const previaSistema = () => screen.getByTestId("previa-sistema");
const previaLogin = () => screen.getByTestId("previa-login");
const arquivos = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

function abrir(settings: Partial<AppSettings> = {}) {
  mocks.settings = { ...BASE, ...settings };
  return render(<BrandTab />);
}

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.settings = { ...BASE };
  mocks.reload.mockReset();
  mocks.reload.mockResolvedValue(undefined);
  for (const fn of Object.values(api)) (fn as ReturnType<typeof vi.fn>).mockReset();
  api.updateSettings.mockImplementation(async (data) => {
    mocks.settings = { ...(mocks.settings as object), ...data };
    return mocks.settings as AppSettings;
  });
  for (const fn of [api.uploadLogo, api.removeLogo, api.uploadFavicon, api.removeFavicon, api.uploadLoginImage, api.removeLoginImage]) {
    (fn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  }
});

describe("BrandTab - a prévia dentro do mesmo cartão do que ela mostra", () => {
  const cartoes = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(".brand-card"));

  it("são três cartões: cores e logo com a prévia do sistema, o login com a prévia do login e as telas de erro", () => {
    const { container } = abrir();

    const [primeira, segunda, terceira] = cartoes(container);
    expect(cartoes(container)).toHaveLength(3);
    expect(within(terceira).getByText("Telas de erro")).toBeTruthy();
    expect(within(terceira).getByTestId("previa-erro-notFound")).toBeTruthy();
    expect(within(terceira).getByTestId("previa-erro-error")).toBeTruthy();
    expect(within(primeira).getByText("Cores")).toBeTruthy();
    expect(within(primeira).getByText("Logo e favicon")).toBeTruthy();
    expect(within(primeira).getByTestId("previa-sistema")).toBeTruthy();
    expect(within(primeira).queryByTestId("previa-login")).toBeNull();
    expect(within(segunda).getByText("Tela de login")).toBeTruthy();
    expect(within(segunda).getByTestId("previa-login")).toBeTruthy();
    expect(within(segunda).queryByTestId("previa-sistema")).toBeNull();
  });

  it("em cada cartão o formulário vem antes e a prévia depois, à direita", () => {
    const { container } = abrir();

    for (const cartao of cartoes(container)) {
      const form = cartao.querySelector(".brand-card-main") as HTMLElement;
      const colunaDaPrevia = cartao.querySelector(".brand-card-preview") as HTMLElement;
      expect(form.compareDocumentPosition(colunaDaPrevia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(colunaDaPrevia).getAllByRole("complementary").length).toBeGreaterThan(0);
    }
  });

  it("a prévia não é um cartão separado: fica dentro do cartão do formulário, na mesma caixa", () => {
    const { container } = abrir();

    for (const previa of screen.getAllByRole("complementary")) {
      const cartao = previa.closest(".brand-card") as HTMLElement;
      expect(cartao).not.toBeNull();
      expect(cartao.querySelector(".brand-card-main")).not.toBeNull();
      // A caixa da prévia não tem borda e fundo próprios: o cartão é um só
      expect(previa.classList.contains("card")).toBe(false);
    }
    expect(container.querySelector(".brand-preview-card")).toBeNull();
  });

  it("as duas prévias das telas de erro ficam juntas, na mesma coluna do mesmo cartão", () => {
    const { container } = abrir();

    const terceiro = cartoes(container)[2];
    const coluna = terceiro.querySelector(".brand-card-preview") as HTMLElement;
    expect(within(coluna).getAllByRole("complementary")).toHaveLength(2);
  });

  it("cada prévia é uma região com nome próprio", () => {
    abrir();

    expect(screen.getByRole("complementary", { name: "Prévia do sistema" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Prévia da tela de login" })).toBeTruthy();
  });

  it("nada fica grudado: não existe mais a coluna de prévias que acompanhava a rolagem", () => {
    const { container } = abrir();

    expect(container.querySelector(".brand-previews")).toBeNull();
    expect(container.querySelector(".brand-form")).toBeNull();
    expect(container.querySelector(".brand-row")).toBeNull();
  });

  it("cada prévia tem uma nota dizendo o que ela mostra", () => {
    abrir();

    expect(screen.getByText("Mostra as cores, mesmo as ainda não salvas, e o logo.")).toBeTruthy();
    expect(screen.getByText("Mostra o layout, a imagem, o logo e as cores.")).toBeTruthy();
  });

  it("cada prévia tem um título próprio e a prévia não repete o texto de cima", () => {
    abrir();

    expect(screen.getByText("Prévia do sistema")).toBeTruthy();
    expect(screen.getByText("Prévia da tela de login")).toBeTruthy();
    expect(previaSistema().getAttribute("data-label")).toBe("null");
    expect(previaLogin().getAttribute("data-label")).toBe("null");
  });

  it("as prévias usam o tamanho maior, que cabe na coluna", () => {
    abrir();

    expect(previaSistema().getAttribute("data-scale")).toBe("0.55");
    expect(previaLogin().getAttribute("data-scale")).toBe("0.55");
  });

  it("as prévias recebem as cores e o layout salvos", () => {
    abrir({ primary_color: "#065F46", secondary_color: "#10B981", login_layout: "split" });

    expect(previaSistema().getAttribute("data-primary")).toBe("#065F46");
    expect(previaSistema().getAttribute("data-secondary")).toBe("#10B981");
    expect(previaLogin().getAttribute("data-layout")).toBe("split");
  });

  it("os textos da aba têm acento", () => {
    abrir();

    expect(screen.getByLabelText("Cor primária")).toBeTruthy();
    expect(screen.getByText("Restaurar padrão")).toBeTruthy();
    expect(screen.getAllByText(/Só valem depois de salvar/)).toHaveLength(2);
  });
});

describe("BrandTab - cores", () => {
  it("sem mudança não mostra a barra de salvar", () => {
    abrir();

    semBarra();
    expect(screen.queryByText("Descartar")).toBeNull();
  });

  it("as prévias seguem as cores ainda não salvas e a barra aparece", () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#065F46" } });

    expect(previaSistema().getAttribute("data-primary")).toBe("#065F46");
    expect(previaLogin().getAttribute("data-primary")).toBe("#065F46");
    expect(salvar().disabled).toBe(false);
    expect(screen.getByText("Você tem alterações não salvas.")).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("a mesma cor escrita em minúsculas não conta como mudança", () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#1e3a6b" } });

    semBarra();
    expect(previaSistema().getAttribute("data-primary")).toBe("#1e3a6b");
  });

  it("o código sem o # é apontado como fora do formato #RRGGBB", () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "065F46" } });

    expect(screen.getByRole("alert").textContent).toBe("Use o formato #RRGGBB");
    expect(salvar().disabled).toBe(true);
  });

  it("código incompleto mostra o erro, mantém a última cor boa na prévia e não deixa salvar", () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#12" } });

    expect(screen.getByRole("alert").textContent).toBe("Use o formato #RRGGBB");
    expect(primaria().getAttribute("aria-invalid")).toBe("true");
    expect(previaSistema().getAttribute("data-primary")).toBe("#1E3A6B");
    expect(salvar().disabled).toBe(true);
    expect(screen.getByText("Corrija o código da cor para poder salvar.")).toBeTruthy();
  });

  it("Descartar volta as duas cores ao que está salvo", () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.change(secundaria(), { target: { value: "#10B981" } });
    fireEvent.click(screen.getByText("Descartar"));

    expect(primaria().value).toBe("#1E3A6B");
    expect(secundaria().value).toBe("#5B9BD5");
    expect(previaSistema().getAttribute("data-primary")).toBe("#1E3A6B");
    semBarra();
  });

  it("uma paleta pronta troca as duas cores de uma vez", () => {
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar a paleta Esmeralda" }));

    expect(primaria().value).toBe("#065F46");
    expect(secundaria().value).toBe("#10B981");
    expect(previaLogin().getAttribute("data-primary")).toBe("#065F46");
    expect(salvar().disabled).toBe(false);
  });

  it("Restaurar padrão volta às cores de fábrica (e só conta como mudança se forem diferentes das salvas)", () => {
    abrir({ primary_color: "#065F46", secondary_color: "#10B981" });

    fireEvent.click(screen.getByText("Restaurar padrão"));

    expect(primaria().value).toBe("#1E3A6B");
    expect(secundaria().value).toBe("#5B9BD5");
    expect(salvar().disabled).toBe(false);
  });

  it("Salvar manda só as duas cores (nenhum texto), recarrega, avisa e esconde a barra", async () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ primary_color: "#065F46", secondary_color: "#5B9BD5" }),
    );
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Alterações salvas."));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => semBarra());
  });

  it("falha ao salvar avisa o erro, mantém as cores digitadas e deixa o botão ligado", async () => {
    abrir();
    api.updateSettings.mockRejectedValue({ response: { data: { detail: "Sem permissão" } } });

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissão", "error"));
    expect(primaria().value).toBe("#065F46");
    await waitFor(() => expect(salvar().disabled).toBe(false));
  });

  it("Enter no campo do código também salva", async () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.submit(primaria().closest("form") as HTMLFormElement);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
  });
});

describe("BrandTab - logo e favicon", () => {
  const enviar = (campo: HTMLInputElement) =>
    fireEvent.change(campo, { target: { files: [new File(["x"], "marca.png", { type: "image/png" })] } });

  it("enviar o logo vale na hora, sem precisar salvar", async () => {
    abrir();

    enviar(arquivos()[0]);

    await waitFor(() => expect(api.uploadLogo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Logo atualizado."));
    expect(mocks.reload).toHaveBeenCalled();
    semBarra();
  });

  it("enviar o favicon vale na hora", async () => {
    abrir();

    enviar(arquivos()[1]);

    await waitFor(() => expect(api.uploadFavicon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Favicon atualizado."));
  });

  it("falha ao enviar o logo avisa o erro", async () => {
    abrir();
    api.uploadLogo.mockRejectedValue({ response: { data: { detail: "Arquivo grande demais" } } });

    enviar(arquivos()[0]);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Arquivo grande demais", "error"));
  });

  it("a descrição avisa que cada imagem vale ao enviar", () => {
    abrir();

    expect(screen.getByText(/Cada imagem vale assim que você a envia/)).toBeTruthy();
  });

  it("o logo enviado aparece na prévia do sistema", () => {
    abrir({ logo_url: "/static/uploads/logo.png" });

    expect(previaSistema().getAttribute("data-logo")).toContain("logo.png");
  });
});

describe("BrandTab - tela de login", () => {
  const layout = (nome: string) => screen.getByRole("radio", { name: new RegExp(nome) }) as HTMLInputElement;

  it("as duas opções de layout ficam num grupo de opções com nome", () => {
    abrir();

    const grupo = screen.getByRole("radiogroup", { name: "Layout da tela de login" });
    expect(within(grupo).getAllByRole("radio")).toHaveLength(2);
    expect(layout("Centralizado").checked).toBe(true);
    expect(layout("Dividido").checked).toBe(false);
  });

  it("escolher o layout dividido vale na hora e a prévia do login já o mostra", async () => {
    abrir();

    fireEvent.click(layout("Dividido"));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ login_layout: "split" }));
    expect(mocks.reload).toHaveBeenCalled();
    semBarra();
  });

  it("falha ao mudar o layout avisa o erro", async () => {
    abrir();
    api.updateSettings.mockRejectedValue(new Error("rede"));

    fireEvent.click(layout("Dividido"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível mudar o layout.", "error"));
  });

  it("o campo da imagem do painel só aparece no layout dividido", () => {
    abrir();
    expect(screen.queryByText("Imagem do painel direito")).toBeNull();

    abrir({ login_layout: "split" });
    expect(screen.getByText("Imagem do painel direito")).toBeTruthy();
  });

  it("o campo da imagem de login é compacto, do mesmo tamanho do logo, e não a caixa grande tracejada", () => {
    const { container } = abrir({ login_layout: "split" });

    expect(container.querySelector(".image-upload-wide")).toBeNull();
    expect(container.querySelectorAll(".image-upload")).toHaveLength(3);
    expect(container.querySelector(".brand-login-image")).not.toBeNull();
  });

  it("enviar a imagem de login vale na hora", async () => {
    abrir({ login_layout: "split" });

    fireEvent.change(arquivos()[2], { target: { files: [new File(["x"], "fundo.jpg", { type: "image/jpeg" })] } });

    await waitFor(() => expect(api.uploadLoginImage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Imagem de login atualizada."));
  });

  it("a imagem de login enviada aparece na prévia do login", () => {
    abrir({ login_layout: "split", login_image_url: "/static/uploads/fundo.jpg" });

    expect(previaLogin().getAttribute("data-image")).toContain("fundo.jpg");
  });
});

describe("BrandTab - telas de erro", () => {
  const campo = (rotulo: string, indice: number) => screen.getAllByLabelText(rotulo)[indice] as HTMLInputElement;
  const tituloNaoEncontrada = () => campo("Título", 0);
  const mensagemNaoEncontrada = () => campo("Mensagem", 0);
  const botaoNaoEncontrada = () => campo("Texto do botão", 0);
  const tituloErro = () => campo("Título", 1);
  const botaoErro = () => campo("Texto do botão", 1);
  const previaNaoEncontrada = () => screen.getByTestId("previa-erro-notFound");
  const previaErro = () => screen.getByTestId("previa-erro-error");

  it("mostra os seis campos, dois grupos, com o texto padrão como sugestão", () => {
    abrir();

    expect(screen.getByText("Página não encontrada (404)")).toBeTruthy();
    expect(screen.getAllByText("Algo deu errado")).not.toHaveLength(0);
    expect(tituloNaoEncontrada().placeholder).toBe("Página não encontrada");
    expect(mensagemNaoEncontrada().placeholder).toBe("O endereço que você tentou acessar não existe ou foi removido.");
    expect(botaoNaoEncontrada().placeholder).toBe("Voltar para o início");
    expect(tituloErro().placeholder).toBe("Algo deu errado");
    expect(screen.getAllByLabelText("Título")).toHaveLength(2);
    expect(screen.getAllByLabelText("Mensagem")).toHaveLength(2);
    expect(screen.getAllByLabelText("Texto do botão")).toHaveLength(2);
  });

  it("sem personalização as prévias mostram os textos padrão e a barra não aparece", () => {
    abrir();

    expect(previaNaoEncontrada().getAttribute("data-title")).toBe("Página não encontrada");
    expect(previaErro().getAttribute("data-title")).toBe("Algo deu errado");
    expect(previaErro().getAttribute("data-button")).toBe("Voltar para o início");
    semBarra();
  });

  it("os textos salvos aparecem nos campos e nas prévias", () => {
    abrir({ not_found_title: "Essa página sumiu", error_button: "Tentar de novo" });

    expect(tituloNaoEncontrada().value).toBe("Essa página sumiu");
    expect(botaoErro().value).toBe("Tentar de novo");
    expect(previaNaoEncontrada().getAttribute("data-title")).toBe("Essa página sumiu");
    expect(previaErro().getAttribute("data-button")).toBe("Tentar de novo");
    expect(previaErro().getAttribute("data-title")).toBe("Algo deu errado");
    semBarra();
  });

  it("digitar muda a prévia da tela certa na hora, sem salvar, e liga a barra", () => {
    abrir();

    fireEvent.change(tituloErro(), { target: { value: "Tivemos um problema" } });

    expect(previaErro().getAttribute("data-title")).toBe("Tivemos um problema");
    expect(previaNaoEncontrada().getAttribute("data-title")).toBe("Página não encontrada");
    expect(salvar().disabled).toBe(false);
    expect(screen.getByText("Você tem alterações não salvas.")).toBeTruthy();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("o contador mostra quantos caracteres foram usados do limite de cada campo", () => {
    abrir();

    fireEvent.change(tituloNaoEncontrada(), { target: { value: "Sumiu" } });
    fireEvent.change(mensagemNaoEncontrada(), { target: { value: "abc" } });

    expect(screen.getByText("5/80. Em branco, usa o texto padrão.")).toBeTruthy();
    expect(screen.getByText("3/300. Em branco, usa o texto padrão.")).toBeTruthy();
    expect(botaoNaoEncontrada().getAttribute("maxlength")).toBe("40");
    expect(tituloNaoEncontrada().getAttribute("maxlength")).toBe("80");
    expect(mensagemNaoEncontrada().getAttribute("maxlength")).toBe("300");
  });

  it("campo em branco ou só com espaços volta a mostrar o texto padrão na prévia", () => {
    abrir({ error_title: "Tivemos um problema" });

    fireEvent.change(tituloErro(), { target: { value: "   " } });

    expect(previaErro().getAttribute("data-title")).toBe("Algo deu errado");
  });

  it("Salvar manda só os textos que mudaram, sem as cores, e esconde a barra", async () => {
    abrir();

    fireEvent.change(tituloErro(), { target: { value: "  Tivemos um problema  " } });
    fireEvent.change(botaoNaoEncontrada(), { target: { value: "Ir para o início" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        error_title: "Tivemos um problema",
        not_found_button: "Ir para o início",
      }),
    );
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Alterações salvas."));
    await waitFor(() => semBarra());
  });

  it("apagar um texto salvo manda nulo, para o servidor voltar ao padrão", async () => {
    abrir({ error_message: "Já estamos vendo isso." });

    fireEvent.change(campo("Mensagem", 1), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ error_message: null }));
  });

  it("cores e textos mudados juntos vão numa gravação só", async () => {
    abrir();

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.change(tituloErro(), { target: { value: "Tivemos um problema" } });
    fireEvent.click(salvar());

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        primary_color: "#065F46",
        secondary_color: "#5B9BD5",
        error_title: "Tivemos um problema",
      }),
    );
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("Descartar desfaz as cores e os textos juntos", () => {
    abrir({ not_found_title: "Essa página sumiu" });

    fireEvent.change(primaria(), { target: { value: "#065F46" } });
    fireEvent.change(tituloNaoEncontrada(), { target: { value: "Outro" } });
    fireEvent.change(tituloErro(), { target: { value: "Tivemos um problema" } });
    fireEvent.click(screen.getByText("Descartar"));

    expect(primaria().value).toBe("#1E3A6B");
    expect(tituloNaoEncontrada().value).toBe("Essa página sumiu");
    expect(tituloErro().value).toBe("");
    semBarra();
  });

  it("Restaurar textos padrão esvazia os seis campos e conta como mudança só se havia texto salvo", () => {
    abrir({ not_found_title: "Essa página sumiu", error_message: "Já estamos vendo isso." });

    fireEvent.click(screen.getByText("Restaurar textos padrão"));

    expect(tituloNaoEncontrada().value).toBe("");
    expect(campo("Mensagem", 1).value).toBe("");
    expect(previaNaoEncontrada().getAttribute("data-title")).toBe("Página não encontrada");
    expect(salvar().disabled).toBe(false);
  });

  it("Restaurar textos padrão sem nada salvo não liga a barra", () => {
    abrir();

    fireEvent.click(screen.getByText("Restaurar textos padrão"));

    semBarra();
  });

  it("falha ao salvar avisa o erro e mantém o que foi digitado", async () => {
    abrir();
    api.updateSettings.mockRejectedValue({ response: { data: { detail: "Sem permissão" } } });

    fireEvent.change(tituloErro(), { target: { value: "Tivemos um problema" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissão", "error"));
    expect(tituloErro().value).toBe("Tivemos um problema");
  });

  it("a prévia da 404 usa o logo da marca e as cores ainda não salvas; a de erro explica por que usa o logo padrão", () => {
    abrir({ logo_url: "/static/uploads/logo.png" });

    fireEvent.change(primaria(), { target: { value: "#065F46" } });

    expect(previaNaoEncontrada().getAttribute("data-logo")).toContain("logo.png");
    expect(previaNaoEncontrada().getAttribute("data-primary")).toBe("#065F46");
    expect(previaErro().getAttribute("data-primary")).toBe("#065F46");
    expect(screen.getByText(/Usa sempre o logo padrão: essa tela aparece quando algo já quebrou/)).toBeTruthy();
  });

  it("as duas prévias de erro são regiões com nome próprio e usam o tamanho que cabe na coluna", () => {
    abrir();

    expect(screen.getByRole("complementary", { name: "Prévia da página não encontrada" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Prévia da tela de erro inesperado" })).toBeTruthy();
    expect(previaNaoEncontrada().getAttribute("data-scale")).toBe("0.55");
    expect(previaErro().getAttribute("data-scale")).toBe("0.55");
  });
});
