import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountTab from "./AccountTab";

const mocks = vi.hoisted(() => ({
  updateName: vi.fn(),
  changePassword: vi.fn(),
  showToast: vi.fn(),
  user: { id: 1, name: "Maria Souza", email: "maria@example.com", is_platform_admin: false } as {
    id: number;
    name: string;
    email: string;
    is_platform_admin: boolean;
    can_change_password?: boolean;
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user, updateName: mocks.updateName, changePassword: mocks.changePassword }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

function serverError(detail: string) {
  return { response: { data: { detail } } };
}

function fillPasswords(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Senha atual"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Nova senha/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirmar nova senha"), { target: { value: confirm } });
}

beforeEach(() => {
  mocks.updateName.mockReset();
  mocks.changePassword.mockReset();
  mocks.showToast.mockReset();
  mocks.user = { id: 1, name: "Maria Souza", email: "maria@example.com", is_platform_admin: false };
});

describe("AccountTab - nome", () => {
  it("mostra o nome e o email atuais, com o email so para leitura", () => {
    render(<AccountTab />);
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Maria Souza");
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.value).toBe("maria@example.com");
    expect(email.readOnly).toBe(true);
  });

  it("o botao so habilita quando o nome mudou e nao esta em branco", () => {
    render(<AccountTab />);
    const button = screen.getByRole("button", { name: "Salvar nome" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Maria Souza" } });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "   " } });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Maria S. Lima" } });
    expect(button.disabled).toBe(false);
  });

  it("salva o nome sem os espacos das pontas e avisa", async () => {
    mocks.updateName.mockResolvedValue(undefined);
    render(<AccountTab />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "  Maria Lima  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));

    await waitFor(() => expect(mocks.updateName).toHaveBeenCalledWith("Maria Lima"));
    expect(mocks.showToast).toHaveBeenCalledWith("Nome atualizado.");
  });

  it("mostra o erro do servidor quando nao consegue salvar o nome", async () => {
    mocks.updateName.mockRejectedValue(serverError("O nome nao pode ficar em branco"));
    render(<AccountTab />);

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Outro nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome" }));

    expect(await screen.findByText("O nome nao pode ficar em branco")).toBeTruthy();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

describe("AccountTab - senha", () => {
  it("troca a senha, limpa os campos e avisa que as outras sessoes cairam", async () => {
    mocks.changePassword.mockResolvedValue(undefined);
    render(<AccountTab />);

    fillPasswords("SenhaAntiga1", "SenhaNova123", "SenhaNova123");
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));

    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith("SenhaAntiga1", "SenhaNova123"));
    await waitFor(() => expect((screen.getByLabelText("Senha atual") as HTMLInputElement).value).toBe(""));
    expect((screen.getByLabelText("Confirmar nova senha") as HTMLInputElement).value).toBe("");
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("Senha alterada"));
  });

  it("confirmacao diferente nao chega no servidor", () => {
    render(<AccountTab />);

    fillPasswords("SenhaAntiga1", "SenhaNova123", "SenhaNova999");
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(screen.getByRole("alert").textContent).toMatch(/confirmacao/);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("senha nova curta nao chega no servidor", () => {
    render(<AccountTab />);

    fillPasswords("SenhaAntiga1", "curta", "curta");
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(screen.getByRole("alert").textContent).toMatch(/pelo menos 8/);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("senha atual errada mostra o erro do servidor e mantem o que foi digitado", async () => {
    mocks.changePassword.mockRejectedValue(serverError("Senha atual incorreta"));
    render(<AccountTab />);

    fillPasswords("SenhaErrada1", "SenhaNova123", "SenhaNova123");
    fireEvent.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Senha atual incorreta");
    expect((screen.getByLabelText(/^Nova senha/) as HTMLInputElement).value).toBe("SenhaNova123");
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("o botao fica desabilitado enquanto faltar algum campo", () => {
    render(<AccountTab />);
    const button = screen.getByRole("button", { name: "Alterar senha" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fillPasswords("SenhaAntiga1", "SenhaNova123", "");
    expect(button.disabled).toBe(true);

    fillPasswords("SenhaAntiga1", "SenhaNova123", "SenhaNova123");
    expect(button.disabled).toBe(false);
  });

  it("conta que entra pelo Google nao mostra o formulario de senha", () => {
    mocks.user = { ...mocks.user, can_change_password: false };
    render(<AccountTab />);

    expect(screen.queryByLabelText("Senha atual")).toBeNull();
    expect(screen.queryByRole("button", { name: "Alterar senha" })).toBeNull();
    expect(screen.getByText(/entra pelo Google/)).toBeTruthy();
    // O nome continua editavel
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("backend antigo, sem o campo can_change_password, mostra o formulario", () => {
    render(<AccountTab />);
    expect(screen.getByRole("button", { name: "Alterar senha" })).toBeTruthy();
  });
});
