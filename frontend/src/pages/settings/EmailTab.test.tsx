import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as emailApi from "../../api/emailSettings";
import type { EmailSettings } from "../../api/emailSettings";
import EmailTab from "./EmailTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@empresa.com" } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../api/emailSettings", () => ({
  getEmailSettings: vi.fn(),
  updateEmailSettings: vi.fn(),
  sendTestEmail: vi.fn(),
}));

const getSettings = vi.mocked(emailApi.getEmailSettings);
const update = vi.mocked(emailApi.updateEmailSettings);
const sendTest = vi.mocked(emailApi.sendTestEmail);

const VAZIO: EmailSettings = {
  smtp_host: null, smtp_port: null, smtp_security: null, smtp_username: null, smtp_password_configured: false,
  smtp_from_email: null, smtp_from_name: null, email_allowed_domains: null, configured: false,
};
const CONFIGURADO: EmailSettings = {
  smtp_host: "smtp.empresa.com", smtp_port: 587, smtp_security: "starttls", smtp_username: "relatorios",
  smtp_password_configured: true, smtp_from_email: "relatorios@empresa.com", smtp_from_name: "BIHoster",
  email_allowed_domains: "empresa.com", configured: true,
};

async function abrir(dados: EmailSettings = VAZIO) {
  getSettings.mockResolvedValue(dados);
  render(<EmailTab />);
  await screen.findByText("Servidor de e-mail (SMTP)");
}

// Por prefixo: alguns rotulos tem um texto de ajuda dentro, que entra no nome do rotulo
const campo = (nome: string) => screen.getByLabelText(new RegExp(`^${nome}`)) as HTMLInputElement;

beforeEach(() => {
  mocks.showToast.mockClear();
  update.mockImplementation(async () => CONFIGURADO);
});

describe("EmailTab - carregar", () => {
  it("sem configuracao comeca com STARTTLS e porta 587", async () => {
    await abrir();

    expect(campo("Porta").value).toBe("587");
    expect((screen.getByLabelText("Seguranca") as HTMLSelectElement).value).toBe("starttls");
    expect(campo("Servidor").value).toBe("");
  });

  it("mostra o que ja esta configurado, e a senha nunca aparece: so um aviso de que existe", async () => {
    await abrir(CONFIGURADO);

    expect(campo("Servidor").value).toBe("smtp.empresa.com");
    expect(campo("Usuario").value).toBe("relatorios");
    expect(campo("E-mail de origem").value).toBe("relatorios@empresa.com");
    const senha = campo("Senha");
    expect(senha.value).toBe("");
    expect(senha.placeholder).toMatch(/Ja configurada/);
  });

  it("avisa quando nao consegue carregar", async () => {
    getSettings.mockRejectedValue(new Error("403"));
    render(<EmailTab />);

    expect(await screen.findByText("Nao foi possivel carregar as configuracoes de e-mail.")).toBeTruthy();
  });
});

describe("EmailTab - salvar", () => {
  it("envia o que foi preenchido e avisa que salvou", async () => {
    await abrir();
    fireEvent.change(campo("Servidor"), { target: { value: " smtp.empresa.com " } });
    fireEvent.change(campo("Usuario"), { target: { value: "relatorios" } });
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
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configuracoes de e-mail salvas."));
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
    fireEvent.change(campo("Usuario"), { target: { value: "" } });

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

    fireEvent.change(screen.getByLabelText("Seguranca"), { target: { value: "ssl" } });

    expect(campo("Porta").value).toBe("465");
  });

  it("uma porta digitada a mao nao e apagada ao trocar a seguranca", async () => {
    await abrir();
    fireEvent.change(campo("Porta"), { target: { value: "2525" } });

    fireEvent.change(screen.getByLabelText("Seguranca"), { target: { value: "ssl" } });

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
