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
  default: (props: { primaryColor: string; secondaryColor: string; logoUrl: string | null }) => (
    <div data-testid="previa-sistema" data-primary={props.primaryColor} data-secondary={props.secondaryColor} data-logo={props.logoUrl ?? ""} />
  ),
}));
vi.mock("../../components/LoginPreview", () => ({
  default: (props: { primaryColor: string; layout: string; loginImageUrl: string | null }) => (
    <div data-testid="previa-login" data-primary={props.primaryColor} data-layout={props.layout} data-image={props.loginImageUrl ?? ""} />
  ),
}));
vi.mock("../../components/ErrorScreenPreview", () => ({
  default: (props: { kind: string; texts: { title: string; message: string; button: string }; logoUrl: string | null; primaryColor: string }) => (
    <div
      data-testid={`previa-erro-${props.kind}`}
      data-title={props.texts.title}
      data-message={props.texts.message}
      data-button={props.texts.button}
      data-primary={props.primaryColor}
      data-logo={props.logoUrl ?? ""}
    />
  ),
}));
vi.mock("../../components/NoticeScreenPreview", () => ({
  default: (props: { kind: string; texts: { title: string; message: string; button: string }; openingLine?: boolean }) => (
    <div
      data-testid={`previa-aviso-${props.kind}`}
      data-title={props.texts.title}
      data-message={props.texts.message}
      data-button={props.texts.button}
      data-opening={String(Boolean(props.openingLine))}
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
  outside_hours_title: null,
  outside_hours_message: null,
  outside_hours_button: null,
  no_access_title: null,
  no_access_message: null,
  no_access_button: null,
} as unknown as AppSettings;

function abrir(settings: Partial<AppSettings> = {}) {
  mocks.settings = { ...BASE, ...settings };
  return render(<BrandTab />);
}

const editar = (nome: string) => fireEvent.click(screen.getByRole("button", { name: `Editar ${nome}` }));
const salvar = () => screen.getByRole("button", { name: /^Salvar/ }) as HTMLButtonElement;
const campo = (nome: string) => screen.getByLabelText(new RegExp(`^${nome}`)) as HTMLInputElement;
const linha = (nome: string) => screen.getByText(nome).closest("li") as HTMLElement;
const arquivos = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));

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

describe("BrandTab - a lista", () => {
  it("tem uma linha por tela, com o nome, uma frase e o botão de editar", () => {
    abrir();

    const nomes = [
      "Cores e logos",
      "Tela de login",
      "Página não encontrada",
      "Algo deu errado",
      "Fora do horário de acesso",
      "Sem acesso a nenhuma coleção",
    ];
    expect(screen.getAllByRole("listitem")).toHaveLength(nomes.length);
    for (const nome of nomes) {
      expect(within(linha(nome)).getByRole("button", { name: `Editar ${nome}` })).toBeTruthy();
      expect(within(linha(nome)).getByText("Padrão")).toBeTruthy();
    }
  });

  it("nada está aberto até clicar em Editar, e as prévias só existem dentro da janela", () => {
    abrir();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("previa-sistema")).toBeNull();
    expect(screen.queryByTestId("previa-login")).toBeNull();
  });

  it("marca como Personalizado só o que foge do padrão", () => {
    abrir({
      primary_color: "#065F46",
      login_layout: "split",
      error_title: "Ops",
    } as Partial<AppSettings>);

    expect(within(linha("Cores e logos")).getByText("Personalizado")).toBeTruthy();
    expect(within(linha("Tela de login")).getByText("Personalizado")).toBeTruthy();
    expect(within(linha("Algo deu errado")).getByText("Personalizado")).toBeTruthy();
    expect(within(linha("Página não encontrada")).getByText("Padrão")).toBeTruthy();
    expect(within(linha("Fora do horário de acesso")).getByText("Padrão")).toBeTruthy();
    expect(within(linha("Sem acesso a nenhuma coleção")).getByText("Padrão")).toBeTruthy();
  });

  it("um logo enviado conta como personalizado, e as mesmas cores de fábrica em minúsculas não", () => {
    abrir({ primary_color: "#1e3a6b", logo_url: "/static/uploads/l.png" } as Partial<AppSettings>);
    expect(within(linha("Cores e logos")).getByText("Personalizado")).toBeTruthy();
  });

  it("as mesmas cores de fábrica, em minúsculas, continuam sendo o padrão", () => {
    abrir({ primary_color: "#1e3a6b", secondary_color: "#5b9bd5" } as Partial<AppSettings>);
    expect(within(linha("Cores e logos")).getByText("Padrão")).toBeTruthy();
  });

  it("sem a marca carregada o botão de editar fica desligado", () => {
    mocks.settings = null;
    render(<BrandTab />);

    expect((screen.getByRole("button", { name: "Editar Cores e logos" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("os textos da aba têm acento", () => {
    abrir();

    expect(screen.getByText("Página não encontrada")).toBeTruthy();
    expect(screen.getByText("Fora do horário de acesso")).toBeTruthy();
    expect(screen.getByText("Sem acesso a nenhuma coleção")).toBeTruthy();
  });
});

describe("BrandTab - cores e logos", () => {
  const primaria = () => campo("Cor primária");
  const secundaria = () => campo("Cor secundária");

  it("abre com as cores salvas e a prévia do sistema, e o botão de salvar desligado", () => {
    abrir({ primary_color: "#065F46", secondary_color: "#10B981" } as Partial<AppSettings>);
    editar("Cores e logos");

    expect(primaria().value).toBe("#065F46");
    expect(secundaria().value).toBe("#10B981");
    expect(screen.getByTestId("previa-sistema").getAttribute("data-primary")).toBe("#065F46");
    expect(salvar().disabled).toBe(true);
  });

  it("a prévia segue a cor ainda não salva e liga o botão de salvar", () => {
    abrir();
    editar("Cores e logos");

    fireEvent.change(primaria(), { target: { value: "#7F1D1D" } });

    expect(screen.getByTestId("previa-sistema").getAttribute("data-primary")).toBe("#7F1D1D");
    expect(salvar().disabled).toBe(false);
  });

  it("a mesma cor escrita em minúsculas não conta como mudança", () => {
    abrir();
    editar("Cores e logos");

    fireEvent.change(primaria(), { target: { value: "#1e3a6b" } });

    expect(salvar().disabled).toBe(true);
  });

  it("código incompleto mostra o erro, mantém a última cor boa na prévia e não deixa salvar", () => {
    abrir();
    editar("Cores e logos");

    fireEvent.change(primaria(), { target: { value: "#12" } });

    expect(screen.getByRole("alert").textContent).toContain("#RRGGBB");
    expect(screen.getByTestId("previa-sistema").getAttribute("data-primary")).toBe("#1E3A6B");
    expect(salvar().disabled).toBe(true);
  });

  it("uma paleta pronta troca as duas cores de uma vez", () => {
    abrir();
    editar("Cores e logos");

    fireEvent.click(screen.getByRole("button", { name: "Aplicar a paleta Esmeralda" }));

    expect(primaria().value).toBe("#065F46");
    expect(secundaria().value).toBe("#10B981");
  });

  it("Restaurar padrão volta às cores de fábrica, como mudança a salvar", () => {
    abrir({ primary_color: "#065F46", secondary_color: "#10B981" } as Partial<AppSettings>);
    editar("Cores e logos");

    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));

    expect(primaria().value).toBe("#1E3A6B");
    expect(secundaria().value).toBe("#5B9BD5");
    expect(salvar().disabled).toBe(false);
  });

  it("Salvar manda só as duas cores, recarrega a marca, avisa e fecha a janela", async () => {
    abrir();
    editar("Cores e logos");

    fireEvent.change(primaria(), { target: { value: "#7F1D1D" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ primary_color: "#7F1D1D", secondary_color: "#5B9BD5" }));
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Cores salvas.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("falha ao salvar avisa o erro e mantém a janela aberta com as cores digitadas", async () => {
    abrir();
    editar("Cores e logos");
    api.updateSettings.mockRejectedValueOnce(new Error("500"));

    fireEvent.change(primaria(), { target: { value: "#7F1D1D" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível salvar as alterações.", "error"));
    expect(primaria().value).toBe("#7F1D1D");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Enter no campo do código também salva", async () => {
    abrir();
    editar("Cores e logos");

    fireEvent.change(primaria(), { target: { value: "#7F1D1D" } });
    fireEvent.submit(primaria().closest("form") as HTMLFormElement);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
  });

  it("enviar o logo vale na hora, sem salvar, e recarrega a marca", async () => {
    abrir();
    editar("Cores e logos");
    const arquivo = new File(["x"], "logo.png", { type: "image/png" });

    fireEvent.change(arquivos()[0], { target: { files: [arquivo] } });

    await waitFor(() => expect(api.uploadLogo).toHaveBeenCalledWith(arquivo));
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Logo atualizado.");
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("enviar o favicon vale na hora", async () => {
    abrir();
    editar("Cores e logos");
    const arquivo = new File(["x"], "fav.png", { type: "image/png" });

    fireEvent.change(arquivos()[1], { target: { files: [arquivo] } });

    await waitFor(() => expect(api.uploadFavicon).toHaveBeenCalledWith(arquivo));
    expect(mocks.showToast).toHaveBeenCalledWith("Favicon atualizado.");
  });

  it("falha ao enviar o logo avisa o erro", async () => {
    abrir();
    editar("Cores e logos");
    api.uploadLogo.mockRejectedValueOnce(new Error("400"));

    fireEvent.change(arquivos()[0], { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível enviar o logo.", "error"));
  });

  it("o logo enviado aparece na prévia do sistema", () => {
    abrir({ logo_url: "/static/uploads/logo.png" } as Partial<AppSettings>);
    editar("Cores e logos");

    expect(screen.getByTestId("previa-sistema").getAttribute("data-logo")).toContain("/static/uploads/logo.png");
  });
});

describe("BrandTab - tela de login", () => {
  it("abre com o layout salvo e a prévia do login", () => {
    abrir({ login_layout: "split" } as Partial<AppSettings>);
    editar("Tela de login");

    expect(screen.getByTestId("previa-login").getAttribute("data-layout")).toBe("split");
    expect(screen.getByRole("radiogroup", { name: "Layout da tela de login" })).toBeTruthy();
    expect(salvar().disabled).toBe(true);
  });

  it("escolher o layout dividido muda a prévia, mas só vale depois de salvar", async () => {
    abrir();
    editar("Tela de login");

    fireEvent.click(screen.getByLabelText(/Dividido, com imagem/));

    expect(screen.getByTestId("previa-login").getAttribute("data-layout")).toBe("split");
    expect(api.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(salvar());
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ login_layout: "split" }));
    expect(mocks.showToast).toHaveBeenCalledWith("Tela de login salva.");
  });

  it("falha ao salvar o layout avisa o erro", async () => {
    abrir();
    editar("Tela de login");
    api.updateSettings.mockRejectedValueOnce(new Error("500"));

    fireEvent.click(screen.getByLabelText(/Dividido, com imagem/));
    fireEvent.click(salvar());

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível mudar o layout.", "error"));
  });

  it("o campo da imagem do painel só aparece no layout dividido", () => {
    abrir();
    editar("Tela de login");

    expect(arquivos()).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/Dividido, com imagem/));
    expect(arquivos()).toHaveLength(1);
  });

  it("enviar a imagem de login vale na hora", async () => {
    abrir({ login_layout: "split" } as Partial<AppSettings>);
    editar("Tela de login");
    const arquivo = new File(["x"], "painel.png", { type: "image/png" });

    fireEvent.change(arquivos()[0], { target: { files: [arquivo] } });

    await waitFor(() => expect(api.uploadLoginImage).toHaveBeenCalledWith(arquivo));
    expect(mocks.showToast).toHaveBeenCalledWith("Imagem de login atualizada.");
  });

  it("a imagem de login enviada aparece na prévia", () => {
    abrir({ login_layout: "split", login_image_url: "/static/uploads/painel.png" } as Partial<AppSettings>);
    editar("Tela de login");

    expect(screen.getByTestId("previa-login").getAttribute("data-image")).toContain("/static/uploads/painel.png");
  });
});

describe("BrandTab - telas de erro e de aviso", () => {
  const salvos = {
    not_found_title: "Sumiu",
    not_found_message: "Não achamos.",
    not_found_button: "Início",
  } as Partial<AppSettings>;

  it("abre com os textos salvos nos campos, o padrão de sugestão e a prévia da tela certa", () => {
    abrir(salvos);
    editar("Página não encontrada");

    expect(campo("Título").value).toBe("Sumiu");
    expect(campo("Mensagem").value).toBe("Não achamos.");
    expect(campo("Texto do botão").value).toBe("Início");
    expect(screen.getByTestId("previa-erro-notFound").getAttribute("data-title")).toBe("Sumiu");
    expect(screen.queryByTestId("previa-erro-error")).toBeNull();
    expect(salvar().disabled).toBe(true);
  });

  it("sem personalização os campos vêm vazios, com o texto padrão de sugestão, e a prévia mostra o padrão", () => {
    abrir();
    editar("Algo deu errado");

    expect(campo("Título").value).toBe("");
    expect(campo("Título").placeholder).toBe("Algo deu errado");
    expect(screen.getByTestId("previa-erro-error").getAttribute("data-title")).toBe("Algo deu errado");
  });

  it("digitar muda a prévia na hora, sem salvar, e liga o botão", () => {
    abrir();
    editar("Algo deu errado");

    fireEvent.change(campo("Título"), { target: { value: "Ops, tente de novo" } });

    expect(screen.getByTestId("previa-erro-error").getAttribute("data-title")).toBe("Ops, tente de novo");
    expect(salvar().disabled).toBe(false);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it("campo só com espaços volta a mostrar o texto padrão na prévia", () => {
    abrir();
    editar("Algo deu errado");

    fireEvent.change(campo("Título"), { target: { value: "   " } });

    expect(screen.getByTestId("previa-erro-error").getAttribute("data-title")).toBe("Algo deu errado");
  });

  it("o contador mostra quantos caracteres foram usados do limite", () => {
    abrir();
    editar("Algo deu errado");

    fireEvent.change(campo("Título"), { target: { value: "Oi" } });

    expect(screen.getByText(/^2\/80\./)).toBeTruthy();
  });

  it("Salvar manda só os textos que mudaram, recarrega, avisa e fecha", async () => {
    abrir();
    editar("Algo deu errado");

    fireEvent.change(campo("Título"), { target: { value: "  Ops  " } });
    fireEvent.click(salvar());

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ error_title: "Ops" }));
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("Tela salva.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("apagar um texto salvo manda nulo, para o servidor voltar ao padrão", async () => {
    abrir(salvos);
    editar("Página não encontrada");

    fireEvent.change(campo("Título"), { target: { value: "" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ not_found_title: null }));
  });

  it("Restaurar o texto padrão limpa os três campos da tela e fecha, sem mexer nas outras telas", async () => {
    abrir({ ...salvos, error_title: "Ops" } as Partial<AppSettings>);
    editar("Página não encontrada");

    fireEvent.click(screen.getByRole("button", { name: "Restaurar o texto padrão" }));

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ not_found_title: null, not_found_message: null, not_found_button: null }),
    );
    expect(mocks.showToast).toHaveBeenCalledWith("Tela restaurada ao texto padrão.");
  });

  it("sem texto salvo não há o botão de restaurar", () => {
    abrir();
    editar("Página não encontrada");

    expect(screen.queryByRole("button", { name: "Restaurar o texto padrão" })).toBeNull();
  });

  it("falha ao salvar mostra o erro na janela e mantém o que foi digitado", async () => {
    abrir();
    editar("Algo deu errado");
    api.updateSettings.mockRejectedValueOnce(new Error("500"));

    fireEvent.change(campo("Título"), { target: { value: "Ops" } });
    fireEvent.click(salvar());

    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível salvar as alterações.");
    expect(campo("Título").value).toBe("Ops");
  });

  it("a prévia das telas de erro usa o logo e as cores da marca", () => {
    abrir({ logo_url: "/static/uploads/logo.png", primary_color: "#065F46" } as Partial<AppSettings>);
    editar("Página não encontrada");

    const previa = screen.getByTestId("previa-erro-notFound");
    expect(previa.getAttribute("data-logo")).toContain("/static/uploads/logo.png");
    expect(previa.getAttribute("data-primary")).toBe("#065F46");
  });

  it("fora do horário: com mensagem própria a linha de quando o acesso volta continua na prévia", () => {
    abrir();
    editar("Fora do horário de acesso");

    expect(screen.getByTestId("previa-aviso-outsideHours").getAttribute("data-opening")).toBe("false");
    fireEvent.change(campo("Mensagem"), { target: { value: "Volte amanhã." } });

    const previa = screen.getByTestId("previa-aviso-outsideHours");
    expect(previa.getAttribute("data-message")).toBe("Volte amanhã.");
    expect(previa.getAttribute("data-opening")).toBe("true");
  });

  it("sem acesso a coleção: o título sugere o nome da pessoa e Salvar manda só o que mudou", async () => {
    abrir();
    editar("Sem acesso a nenhuma coleção");

    expect(campo("Título").placeholder).toBe("Bem-vindo, e o nome da pessoa");
    fireEvent.change(campo("Texto do botão"), { target: { value: "Encerrar sessão" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ no_access_button: "Encerrar sessão" }));
  });

  it("Cancelar fecha a janela sem gravar nada", () => {
    abrir();
    editar("Algo deu errado");

    fireEvent.change(campo("Título"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });
});
