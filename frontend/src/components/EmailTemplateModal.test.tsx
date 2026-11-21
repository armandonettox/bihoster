import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/emailTemplates";
import type { EmailTemplate } from "../api/emailTemplates";
import EmailTemplateModal from "./EmailTemplateModal";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@empresa.com" } }) }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/emailTemplates", () => ({
  previewEmailTemplate: vi.fn(),
  saveEmailTemplate: vi.fn(),
  resetEmailTemplate: vi.fn(),
  sendEmailTemplateTest: vi.fn(),
}));

const preview = vi.mocked(api.previewEmailTemplate);
const save = vi.mocked(api.saveEmailTemplate);
const reset = vi.mocked(api.resetEmailTemplate);
const sendTest = vi.mocked(api.sendEmailTemplateTest);

function modelo(extra: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    key: "reset",
    label: "Redefinição de senha",
    description: "Enviado quando alguém pede o link.",
    variables: [
      { name: "saudacao", label: "Saudação", sample: "Olá, Maria." },
      { name: "empresa", label: "Nome da empresa", sample: "BIHoster" },
    ],
    has_button: true,
    default_subject: "Redefinição de senha - {empresa}",
    default_body: "{saudacao}\n\nUse o botão abaixo.",
    default_button: "Criar senha nova",
    subject: null,
    body: null,
    button: null,
    customized: false,
    ...extra,
  };
}

const onSaved = vi.fn();
const onClose = vi.fn();

function abrir(template = modelo(), canSendTest = true) {
  return render(<EmailTemplateModal template={template} canSendTest={canSendTest} onSaved={onSaved} onClose={onClose} />);
}

const assunto = () => screen.getByLabelText("Assunto") as HTMLInputElement;
const mensagem = () => screen.getByLabelText(/^Mensagem/) as HTMLTextAreaElement;
const botao = () => screen.getByLabelText("Texto do botão") as HTMLInputElement;
const salvar = () => screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;

beforeEach(() => {
  for (const fn of [preview, save, reset, sendTest, onSaved, onClose, mocks.showToast]) fn.mockReset();
  preview.mockResolvedValue({ subject: "Redefinição de senha - BIHoster", html: "<p>Olá</p>" });
  save.mockResolvedValue(modelo({ customized: true, subject: "Nova senha" }));
  reset.mockResolvedValue(modelo());
  sendTest.mockResolvedValue(undefined);
});

describe("EmailTemplateModal - campos", () => {
  it("vêm com o texto padrão quando nada foi personalizado, para editar em vez de escrever do zero", () => {
    abrir();

    expect(assunto().value).toBe("Redefinição de senha - {empresa}");
    expect(mensagem().value).toBe("{saudacao}\n\nUse o botão abaixo.");
    expect(botao().value).toBe("Criar senha nova");
  });

  it("vêm com o texto personalizado onde o administrador escreveu, e o padrão no resto", () => {
    abrir(modelo({ customized: true, subject: "Nova senha", button: "Trocar" }));

    expect(assunto().value).toBe("Nova senha");
    expect(mensagem().value).toBe("{saudacao}\n\nUse o botão abaixo.");
    expect(botao().value).toBe("Trocar");
  });

  it("e-mail sem botão não mostra o campo do botão", () => {
    abrir(modelo({ has_button: false, default_button: null }));

    expect(screen.queryByLabelText("Texto do botão")).toBeNull();
  });

  it("mostra a descrição e as variáveis como botões", () => {
    abrir();

    expect(screen.getByText("Enviado quando alguém pede o link.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "{saudacao}" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "{empresa}" })).toBeTruthy();
  });

  it("clicar numa variável insere no campo em que a pessoa estava, no lugar do cursor", () => {
    abrir();
    mensagem().focus();
    mensagem().setSelectionRange(0, 0);

    fireEvent.click(screen.getByRole("button", { name: "{empresa}" }));

    expect(mensagem().value.startsWith("{empresa}{saudacao}")).toBe(true);
    expect(assunto().value).toBe("Redefinição de senha - {empresa}");
  });

  it("sem ter focado nenhum campo a variável entra na mensagem; focando o assunto, entra nele", () => {
    abrir();
    assunto().focus();
    assunto().setSelectionRange(0, 0);

    fireEvent.click(screen.getByRole("button", { name: "{saudacao}" }));

    expect(assunto().value.startsWith("{saudacao}Redefinição")).toBe(true);
  });
});

describe("EmailTemplateModal - prévia", () => {
  it("mostra o HTML da prévia num quadro sem permissões e o assunto de exemplo", async () => {
    abrir();

    const quadro = (await screen.findByTitle("Prévia do e-mail")) as HTMLIFrameElement;
    expect(quadro.getAttribute("sandbox")).toBe("");
    expect(quadro.getAttribute("srcdoc")).toBe("<p>Olá</p>");
    expect(screen.getByText("Redefinição de senha - BIHoster")).toBeTruthy();
  });

  it("pede a prévia com o que está digitado e refaz ao mudar", async () => {
    abrir();
    await screen.findByTitle("Prévia do e-mail");
    expect(preview).toHaveBeenLastCalledWith("reset", { subject: null, body: null, button: null });

    fireEvent.change(assunto(), { target: { value: "Nova senha - {empresa}" } });

    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith("reset", { subject: "Nova senha - {empresa}", body: null, button: null }),
    );
  });

  it("mostra o erro do servidor (variável desconhecida) e mantém a última prévia", async () => {
    abrir();
    await screen.findByTitle("Prévia do e-mail");
    preview.mockRejectedValue({ response: { data: { detail: "Variável que este e-mail não tem: {x}." } } });

    fireEvent.change(assunto(), { target: { value: "Oi {x}" } });

    expect(await screen.findByText("Variável que este e-mail não tem: {x}.")).toBeTruthy();
    expect(screen.getByTitle("Prévia do e-mail")).toBeTruthy();
  });
});

describe("EmailTemplateModal - salvar e restaurar", () => {
  it("Salvar só liga depois de mudar alguma coisa", () => {
    abrir();
    expect(salvar().disabled).toBe(true);

    fireEvent.change(assunto(), { target: { value: "Nova senha" } });

    expect(salvar().disabled).toBe(false);
  });

  it("manda só o que mudou: o que é igual ao padrão vai como nulo", async () => {
    abrir();

    fireEvent.change(assunto(), { target: { value: "  Nova senha  " } });
    fireEvent.click(salvar());

    await waitFor(() => expect(save).toHaveBeenCalledWith("reset", { subject: "Nova senha", body: null, button: null }));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("E-mail salvo.");
  });

  it("e-mail sem botão não manda o campo do botão", async () => {
    abrir(modelo({ has_button: false, default_button: null }));

    fireEvent.change(assunto(), { target: { value: "Outro" } });
    fireEvent.click(salvar());

    await waitFor(() => expect(save).toHaveBeenCalledWith("reset", { subject: "Outro", body: null }));
  });

  it("mostra o motivo quando o servidor recusa e mantém a janela aberta", async () => {
    save.mockRejectedValue({ response: { data: { detail: "O assunto pode ter até 150 caracteres." } } });
    abrir();

    fireEvent.change(assunto(), { target: { value: "Nova senha" } });
    fireEvent.click(salvar());

    expect(await screen.findByText("O assunto pode ter até 150 caracteres.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Restaurar o texto padrão só aparece em e-mail personalizado e apaga a personalização", async () => {
    const { unmount } = abrir();
    expect(screen.queryByRole("button", { name: "Restaurar o texto padrão" })).toBeNull();
    unmount();

    abrir(modelo({ customized: true, subject: "Nova senha" }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurar o texto padrão" }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith("reset"));
    expect(mocks.showToast).toHaveBeenCalledWith("E-mail restaurado ao texto padrão.");
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("EmailTemplateModal - enviar teste", () => {
  it("começa com o e-mail de quem está logado e manda o que está digitado", async () => {
    abrir();
    expect((screen.getByLabelText("Enviar um teste para") as HTMLInputElement).value).toBe("admin@empresa.com");

    fireEvent.change(assunto(), { target: { value: "Rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));

    await waitFor(() =>
      expect(sendTest).toHaveBeenCalledWith("reset", "admin@empresa.com", { subject: "Rascunho", body: null, button: null }),
    );
    expect(await screen.findByText("Teste enviado para admin@empresa.com. Confira a caixa de entrada.")).toBeTruthy();
  });

  it("sem servidor de e-mail configurado o botão fica desligado e explica", () => {
    abrir(modelo(), false);

    expect((screen.getByRole("button", { name: "Enviar teste" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Salve o servidor de e-mail para poder enviar o teste.")).toBeTruthy();
  });

  it("mostra o motivo da falha", async () => {
    sendTest.mockRejectedValue({ response: { data: { detail: "O servidor recusou o usuário ou a senha." } } });
    abrir();

    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));

    expect(await screen.findByText("O servidor recusou o usuário ou a senha.")).toBeTruthy();
  });
});
