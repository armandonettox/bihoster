import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as emailApi from "../../api/emailSettings";
import type { EmailSettings } from "../../api/emailSettings";
import * as templatesApi from "../../api/emailTemplates";
import type { EmailTemplate } from "../../api/emailTemplates";
import EmailTab from "./EmailTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@empresa.com" } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../api/emailSettings", () => ({
  getEmailSettings: vi.fn(),
  updateEmailSettings: vi.fn(),
  sendTestEmail: vi.fn(),
  uploadEmailLogo: vi.fn(),
  removeEmailLogo: vi.fn(),
}));

vi.mock("../../api/emailTemplates", () => ({
  listEmailTemplates: vi.fn(),
  saveEmailTemplate: vi.fn(),
  resetEmailTemplate: vi.fn(),
  previewEmailTemplate: vi.fn(),
  sendEmailTemplateTest: vi.fn(),
}));

const listTemplates = vi.mocked(templatesApi.listEmailTemplates);
const previewTemplate = vi.mocked(templatesApi.previewEmailTemplate);

function modelo(extra: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    key: "reset",
    label: "Redefinição de senha",
    description: "Enviado quando alguém pede o link.",
    variables: [{ name: "empresa", label: "Nome da empresa", sample: "BIHoster" }],
    has_button: true,
    default_subject: "Redefinição de senha - {empresa}",
    default_body: "Oi.\n\nUse o botão.",
    default_button: "Criar senha nova",
    subject: null,
    body: null,
    button: null,
    customized: false,
    ...extra,
  };
}

const getSettings = vi.mocked(emailApi.getEmailSettings);
const update = vi.mocked(emailApi.updateEmailSettings);
const sendTest = vi.mocked(emailApi.sendTestEmail);
const uploadLogo = vi.mocked(emailApi.uploadEmailLogo);
const removeLogo = vi.mocked(emailApi.removeEmailLogo);

const VAZIO: EmailSettings = {
  smtp_host: null, smtp_port: null, smtp_security: null, smtp_username: null, smtp_password_configured: false,
  smtp_from_email: null, smtp_from_name: null, email_allowed_domains: null, email_logo_url: null, configured: false,
};
const CONFIGURADO: EmailSettings = {
  smtp_host: "smtp.empresa.com", smtp_port: 587, smtp_security: "starttls", smtp_username: "relatorios",
  smtp_password_configured: true, smtp_from_email: "relatorios@empresa.com", smtp_from_name: "BIHoster",
  email_allowed_domains: "empresa.com", email_logo_url: null, configured: true,
};

async function abrir(dados: EmailSettings = VAZIO) {
  getSettings.mockResolvedValue(dados);
  render(<EmailTab />);
  await screen.findByText("Servidor de e-mail (SMTP)");
}

// Por prefixo: alguns rotulos tem um texto de ajuda dentro, que entra no nome do rotulo
const campo = (nome: string) => screen.getByLabelText(new RegExp(`^${nome}`)) as HTMLInputElement;

beforeEach(() => {
  listTemplates.mockReset();
  listTemplates.mockResolvedValue([]);
  previewTemplate.mockReset();
  previewTemplate.mockResolvedValue({ subject: "Assunto", html: "<p>oi</p>" });
  mocks.showToast.mockClear();
  update.mockImplementation(async () => CONFIGURADO);
});

describe("EmailTab - carregar", () => {
  it("sem configuracao comeca com STARTTLS e porta 587", async () => {
    await abrir();

    expect(campo("Porta").value).toBe("587");
    expect((screen.getByLabelText("Segurança") as HTMLSelectElement).value).toBe("starttls");
    expect(campo("Servidor").value).toBe("");
  });

  it("mostra o que ja esta configurado, e a senha nunca aparece: so um aviso de que existe", async () => {
    await abrir(CONFIGURADO);

    expect(campo("Servidor").value).toBe("smtp.empresa.com");
    expect(campo("Usuário").value).toBe("relatorios");
    expect(campo("E-mail de origem").value).toBe("relatorios@empresa.com");
    const senha = campo("Senha");
    expect(senha.value).toBe("");
    expect(senha.placeholder).toMatch(/Já configurada/);
  });

  it("avisa quando nao consegue carregar", async () => {
    getSettings.mockRejectedValue(new Error("403"));
    render(<EmailTab />);

    expect(await screen.findByText("Não foi possível carregar as configurações de e-mail.")).toBeTruthy();
  });
});

describe("EmailTab - salvar", () => {
  it("envia o que foi preenchido e avisa que salvou", async () => {
    await abrir();
    fireEvent.change(campo("Servidor"), { target: { value: " smtp.empresa.com " } });
    fireEvent.change(campo("Usuário"), { target: { value: "relatorios" } });
    fireEvent.change(campo("Senha"), { target: { value: "segredo" } });
    fireEvent.change(campo("E-mail de origem"), { target: { value: "relatorios@empresa.com" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({
      smtp_host: "smtp.empresa.com",
      smtp_port: 587,
      smtp_security: "starttls",
      smtp_username: "relatorios",
      smtp_password: "segredo",
      smtp_from_email: "relatorios@empresa.com",
    });
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configurações de e-mail salvas."));
  });

  it("deixar a senha em branco mantem a atual: o campo nem vai no pedido", async () => {
    await abrir(CONFIGURADO);

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).not.toHaveProperty("smtp_password");
  });

  it("apagar a senha salva manda texto vazio", async () => {
    await abrir(CONFIGURADO);

    fireEvent.click(screen.getByLabelText("Apagar a senha salva"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].smtp_password).toBe("");
  });

  it("campos vazios viram nulo, e nao texto vazio", async () => {
    await abrir(CONFIGURADO);
    fireEvent.change(campo("Usuário"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].smtp_username).toBeNull();
  });

  it("mostra o motivo quando o servidor recusa", async () => {
    update.mockRejectedValue({ response: { data: { detail: "Para usar usuario e senha escolha STARTTLS ou SSL" } } });
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Para usar usuario e senha escolha STARTTLS ou SSL")).toBeTruthy();
  });
});

describe("EmailTab - porta e seguranca", () => {
  it("trocar a seguranca sugere a porta do novo tipo", async () => {
    await abrir();

    fireEvent.change(screen.getByLabelText("Segurança"), { target: { value: "ssl" } });

    expect(campo("Porta").value).toBe("465");
  });

  it("uma porta digitada a mao nao e apagada ao trocar a seguranca", async () => {
    await abrir();
    fireEvent.change(campo("Porta"), { target: { value: "2525" } });

    fireEvent.change(screen.getByLabelText("Segurança"), { target: { value: "ssl" } });

    expect(campo("Porta").value).toBe("2525");
  });
});

describe("EmailTab - e-mail de teste", () => {
  it("comeca com o e-mail de quem esta logado, mas so envia depois de configurado", async () => {
    await abrir();

    expect(campo("Enviar para").value).toBe("admin@empresa.com");
    expect((screen.getByRole("button", { name: "Enviar teste" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Salve o servidor e o e-mail de origem/)).toBeTruthy();
  });

  it("envia o teste e confirma", async () => {
    sendTest.mockResolvedValue(undefined);
    await abrir(CONFIGURADO);
    fireEvent.change(campo("Enviar para"), { target: { value: "outra@empresa.com" } });

    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));

    expect(await screen.findByText(/E-mail de teste enviado para outra@empresa.com/)).toBeTruthy();
    expect(sendTest).toHaveBeenCalledWith("outra@empresa.com");
  });

  it("mostra o motivo da falha (senha errada, servidor fora do ar...)", async () => {
    sendTest.mockRejectedValue({ response: { data: { detail: "O servidor recusou o usuario ou a senha do SMTP." } } });
    await abrir(CONFIGURADO);

    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));

    expect(await screen.findByText("O servidor recusou o usuario ou a senha do SMTP.")).toBeTruthy();
  });
});

describe("EmailTab - e-mails enviados pelo sistema", () => {
  it("lista cada e-mail com o nome, a descrição e se é padrão ou personalizado", async () => {
    listTemplates.mockResolvedValue([
      modelo(),
      modelo({ key: "added", label: "Adicionado ao sistema", description: "Enviado a quem já tem conta.", customized: true, subject: "Bem-vindo" }),
    ]);
    await abrir(CONFIGURADO);

    expect(await screen.findByText("Redefinição de senha")).toBeTruthy();
    expect(screen.getByText("Adicionado ao sistema")).toBeTruthy();
    expect(screen.getByText("Enviado quando alguém pede o link.")).toBeTruthy();
    expect(screen.getByText("Padrão")).toBeTruthy();
    expect(screen.getByText("Personalizado")).toBeTruthy();
  });

  it("Editar abre o editor daquele e-mail", async () => {
    listTemplates.mockResolvedValue([modelo()]);
    await abrir(CONFIGURADO);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Assunto") as HTMLInputElement).value).toBe("Redefinição de senha - {empresa}");
  });

  it("avisa quando não consegue carregar os e-mails, sem derrubar o servidor", async () => {
    listTemplates.mockRejectedValue(new Error("500"));
    await abrir(CONFIGURADO);

    expect(await screen.findByText("Não foi possível carregar os e-mails.")).toBeTruthy();
    expect(campo("Servidor").value).toBe("smtp.empresa.com");
  });

  it("depois de salvar no editor a linha vira Personalizado", async () => {
    listTemplates.mockResolvedValue([modelo()]);
    vi.mocked(templatesApi.saveEmailTemplate).mockResolvedValue(modelo({ customized: true, subject: "Nova senha" }));
    await abrir(CONFIGURADO);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Assunto"), { target: { value: "Nova senha" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Personalizado")).toBeTruthy();
  });
});

describe("EmailTab - logo dos e-mails", () => {
  it("envia a imagem escolhida e mostra o logo novo", async () => {
    await abrir(CONFIGURADO);
    uploadLogo.mockResolvedValue({ ...CONFIGURADO, email_logo_url: "/static/uploads/novo.png" });

    const arquivo = new File(["x"], "logo.png", { type: "image/png" });
    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [arquivo] } });

    await waitFor(() => expect(uploadLogo).toHaveBeenCalledWith(arquivo));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Logo dos e-mails atualizado."));
    expect(document.querySelector('img[src$="/static/uploads/novo.png"]')).toBeTruthy();
  });

  it("sem logo proprio nao mostra a opcao de remover", async () => {
    await abrir(CONFIGURADO);
    expect(removeLogo).not.toHaveBeenCalled();
    expect(document.querySelector(".kebab-menu-item-danger")).toBeNull();
  });

  it("avisa quando o envio falha", async () => {
    await abrir(CONFIGURADO);
    uploadLogo.mockRejectedValue(new Error("400"));

    const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(entrada, { target: { files: [new File(["x"], "logo.png", { type: "image/png" })] } });

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível enviar o logo.", "error"));
  });
});
