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
    login_provider?: "google" | "password";
    picture_url?: string | null;
    created_at?: string | null;
    last_login_at?: string | null;
    groups?: string[];
    google_locale?: string | null;
    google_domain?: string | null;
    google_workspace?: boolean;
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

  it("conta Google mostra o selo de login pelo Google e a foto", () => {
    mocks.user = { ...mocks.user, can_change_password: false, login_provider: "google", picture_url: "/static/uploads/avatar-1-x.png" };
    const { container } = render(<AccountTab />);

    const badge = screen.getByText("Verificado pelo Google");
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("img.user-avatar-img")?.getAttribute("src")).toContain("avatar-1-x.png");
  });

  it("conta Google nao pode alterar nome nem email: campos travados e sem botao de salvar", () => {
    mocks.user = { ...mocks.user, can_change_password: false, login_provider: "google" };
    render(<AccountTab />);

    expect((screen.getByLabelText("Nome") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Salvar nome" })).toBeNull();
  });

  it("conta Google explica ao passar o cursor que nome e email vem do Google", () => {
    mocks.user = { ...mocks.user, can_change_password: false, login_provider: "google" };
    render(<AccountTab />);

    for (const label of ["Nome", "Email"]) {
      const title = screen.getByLabelText(label).closest("label")?.getAttribute("title") ?? "";
      expect(title).toMatch(/Nao e possivel editar/);
      expect(title).toMatch(/Google/);
    }
  });

  it("resumo da conta mostra desde quando, tipo de acesso, grupos e ultimo login", () => {
    mocks.user = {
      ...mocks.user,
      is_platform_admin: true,
      created_at: "2026-03-05T12:00:00Z",
      last_login_at: "2026-11-11T15:30:00Z",
      groups: ["Todos os usuarios", "Administradores"],
    };
    render(<AccountTab />);

    expect(screen.getByText("Resumo da conta")).toBeTruthy();
    expect(screen.getByText("Administrador da plataforma")).toBeTruthy();
    expect(screen.getByText("Todos os usuarios, Administradores")).toBeTruthy();
    expect(screen.getByText("Membro desde")).toBeTruthy();
    expect(screen.getByText("Ultimo login")).toBeTruthy();
    // Conta com senha nao tem as linhas do Google
    expect(screen.queryByText("Dominio Google")).toBeNull();
    expect(screen.queryByText("Idioma da conta Google")).toBeNull();
  });

  it("resumo da conta Google traz dominio, Workspace e idioma", () => {
    mocks.user = {
      ...mocks.user,
      can_change_password: false,
      login_provider: "google",
      google_domain: "empresa.com.br",
      google_workspace: true,
      google_locale: "pt-BR",
    };
    render(<AccountTab />);

    expect(screen.getByText("empresa.com.br (Google Workspace)")).toBeTruthy();
    expect(screen.getByText("Idioma da conta Google")).toBeTruthy();
  });

  it("backend antigo, sem os dados do resumo, ainda mostra o tipo de acesso sem quebrar", () => {
    render(<AccountTab />);
    expect(screen.getByText("Usuario")).toBeTruthy();
    expect(screen.queryByText("Membro desde")).toBeNull();
  });

  it("conta com senha nao mostra o selo do Google e usa as iniciais", () => {
    const { container } = render(<AccountTab />);

    expect(screen.queryByText("Verificado pelo Google")).toBeNull();
    expect(container.querySelector("img.user-avatar-img")).toBeNull();
    expect(container.querySelector(".user-avatar")?.textContent).toBe("MA");
  });

  it("backend antigo, sem o campo can_change_password, mostra o formulario", () => {
    render(<AccountTab />);
    expect(screen.getByRole("button", { name: "Alterar senha" })).toBeTruthy();
  });
});
