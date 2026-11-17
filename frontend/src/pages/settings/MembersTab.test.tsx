import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../../api/groups";
import * as usersApi from "../../api/users";
import type { PendingInvite, UserDirectoryEntry, UserGroup } from "../../api/users";
import MembersTab from "./MembersTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/BrandingContext", () => ({ useBranding: () => ({ settings: { timezone: "America/Sao_Paulo" } }) }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("../../api/users", () => ({
  listUsers: vi.fn(),
  listPendingInvites: vi.fn(),
  generateResetLink: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("../../api/groups", () => ({
  listGroups: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  inviteGroupMember: vi.fn(),
  cancelGroupInvite: vi.fn(),
}));

const listUsers = vi.mocked(usersApi.listUsers);
const listInvites = vi.mocked(usersApi.listPendingInvites);
const generateResetLink = vi.mocked(usersApi.generateResetLink);
const deleteUser = vi.mocked(usersApi.deleteUser);
const listGroups = vi.mocked(groupsApi.listGroups);
const addGroupMember = vi.mocked(groupsApi.addGroupMember);
const inviteGroupMember = vi.mocked(groupsApi.inviteGroupMember);

const PADRAO: UserGroup = { id: 10, name: "Todos os usuários", is_default: true, is_admin_group: false };
const DADOS: UserGroup = { id: 20, name: "Dados", is_default: false, is_admin_group: false };
const DIRETORIA: UserGroup = { id: 30, name: "Diretoria", is_default: false, is_admin_group: false };
const FINANCEIRO: UserGroup = { id: 40, name: "Financeiro com um nome bem comprido", is_default: false, is_admin_group: false };

const GRUPOS = [PADRAO, DADOS, DIRETORIA, FINANCEIRO];

/** Pessoa n (o id 1 é a pessoa logada). Por padrão só está no grupo padrão. */
function pessoa(n: number, groups: UserGroup[] = [PADRAO]): UserDirectoryEntry {
  const nome = `Pessoa ${String(n).padStart(2, "0")}`;
  return { id: n, name: nome, email: `pessoa${n}@exemplo.com`, groups, last_login: null, permission_level_id: null };
}

function pessoas(total: number): UserDirectoryEntry[] {
  return Array.from({ length: total }, (_, i) => pessoa(i + 1));
}

function convite(email: string, group: UserGroup, id = 1): PendingInvite {
  return { id, email, group_id: group.id, group_name: group.name, created_at: "2026-11-10T10:00:00Z" };
}

async function abrir(users: UserDirectoryEntry[], invites: PendingInvite[] = []) {
  listUsers.mockResolvedValue(users);
  listInvites.mockResolvedValue(invites);
  const resultado = render(<MembersTab />);
  await screen.findByText("Membros");
  return resultado;
}

const linhasDaTabela = () => Array.from(document.querySelectorAll("tbody tr"));
const nomesNaTabela = () => linhasDaTabela().map((tr) => tr.querySelector("td")?.textContent ?? "");
// O e-mail de um convite aparece em duas células (nome e e-mail): vale a primeira ocorrência da linha
const linha = (texto: string) => screen.getAllByText(texto)[0].closest("tr") as HTMLElement;
const gruposDe = (texto: string) => within(linha(texto)).getByRole("button", { name: /^Grupos de/ });
const intervalo = () => screen.getByRole("status").textContent;
const paginacao = () => screen.getByRole("navigation", { name: "Paginação" });

beforeEach(() => {
  mocks.showToast.mockClear();
  for (const fn of [listUsers, listInvites, generateResetLink, deleteUser, listGroups, addGroupMember, inviteGroupMember]) fn.mockReset();
  listGroups.mockResolvedValue(GRUPOS as never);
  addGroupMember.mockResolvedValue(undefined as never);
  inviteGroupMember.mockResolvedValue({ status: "added", email: "nova@exemplo.com" });
  deleteUser.mockResolvedValue(undefined);
});

describe("MembersTab - linhas por página", () => {
  it("mostra 20 linhas por padrão, mesmo com muita gente", async () => {
    await abrir(pessoas(57));

    expect(linhasDaTabela()).toHaveLength(20);
    expect(intervalo()).toBe("1-20 de 57");
    expect((screen.getByLabelText("Linhas por página") as HTMLSelectElement).value).toBe("20");
  });

  it("com 20 pessoas ou menos mostra todas, sem mais de uma página", async () => {
    await abrir(pessoas(12));

    expect(linhasDaTabela()).toHaveLength(12);
    expect(intervalo()).toBe("1-12 de 12");
    expect((screen.getByText("Próxima") as HTMLButtonElement).disabled).toBe(true);
    expect(within(paginacao()).getAllByRole("button", { name: /^Página/ })).toHaveLength(1);
  });

  it("Próxima mostra as pessoas seguintes e a última página tem só as que sobram", async () => {
    await abrir(pessoas(57));

    fireEvent.click(screen.getByText("Próxima"));
    expect(intervalo()).toBe("21-40 de 57");
    expect(nomesNaTabela()[0]).toContain("Pessoa 21");
    expect(linhasDaTabela()).toHaveLength(20);

    fireEvent.click(screen.getByText("Próxima"));
    expect(intervalo()).toBe("41-57 de 57");
    expect(linhasDaTabela()).toHaveLength(17);
    expect(nomesNaTabela().at(-1)).toContain("Pessoa 57");
    expect((screen.getByText("Próxima") as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicar no número da página vai direto para ela, e Anterior volta", async () => {
    await abrir(pessoas(57));

    fireEvent.click(within(paginacao()).getByRole("button", { name: "Página 3" }));
    expect(nomesNaTabela()[0]).toContain("Pessoa 41");

    fireEvent.click(screen.getByText("Anterior"));
    expect(nomesNaTabela()[0]).toContain("Pessoa 21");
  });

  it("aumentar a quantidade por página mostra mais linhas e volta para a primeira página", async () => {
    await abrir(pessoas(120));
    fireEvent.click(screen.getByText("Próxima"));
    expect(intervalo()).toBe("21-40 de 120");

    fireEvent.change(screen.getByLabelText("Linhas por página"), { target: { value: "50" } });

    expect(linhasDaTabela()).toHaveLength(50);
    expect(intervalo()).toBe("1-50 de 120");

    fireEvent.change(screen.getByLabelText("Linhas por página"), { target: { value: "100" } });
    expect(linhasDaTabela()).toHaveLength(100);
    expect(intervalo()).toBe("1-100 de 120");
  });

  it("reduzir para 10 por página também funciona", async () => {
    await abrir(pessoas(57));

    fireEvent.change(screen.getByLabelText("Linhas por página"), { target: { value: "10" } });

    expect(linhasDaTabela()).toHaveLength(10);
    expect(intervalo()).toBe("1-10 de 57");
  });

  it("o filtro volta para a primeira página e conta só o que sobrou", async () => {
    await abrir(pessoas(57));
    fireEvent.click(screen.getByText("Próxima"));

    fireEvent.change(screen.getByLabelText("Filtrar membros por nome ou e-mail"), { target: { value: "pessoa5" } });

    // "pessoa5" acha a 5 e a 50 até a 57
    expect(intervalo()).toBe("1-9 de 9");
    expect(linhasDaTabela()).toHaveLength(9);
  });

  it("o filtro também acha pelo e-mail", async () => {
    await abrir(pessoas(30));

    fireEvent.change(screen.getByLabelText("Filtrar membros por nome ou e-mail"), { target: { value: "pessoa7@" } });

    expect(linhasDaTabela()).toHaveLength(1);
    expect(nomesNaTabela()[0]).toContain("Pessoa 07");
  });

  it("sem resultado mostra a mensagem e esconde o rodapé de páginas", async () => {
    await abrir(pessoas(30));

    fireEvent.change(screen.getByLabelText("Filtrar membros por nome ou e-mail"), { target: { value: "ninguem" } });

    expect(screen.getByText("Nenhum membro encontrado.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Paginação" })).toBeNull();
  });

  it("os convites pendentes vêm primeiro e contam no total", async () => {
    const convites = [convite("novo1@exemplo.com", PADRAO, 1), convite("novo2@exemplo.com", PADRAO, 2), convite("novo3@exemplo.com", PADRAO, 3)];
    await abrir(pessoas(19), convites);

    expect(intervalo()).toBe("1-20 de 22");
    // A primeira célula traz as iniciais do avatar antes do e-mail
    const primeiras = nomesNaTabela().slice(0, 3);
    expect(primeiras[0].endsWith("novo1@exemplo.com")).toBe(true);
    expect(primeiras[1].endsWith("novo2@exemplo.com")).toBe(true);
    expect(primeiras[2].endsWith("novo3@exemplo.com")).toBe(true);
    expect(nomesNaTabela()[3]).toContain("Pessoa 01");

    fireEvent.click(screen.getByText("Próxima"));
    expect(intervalo()).toBe("21-22 de 22");
    expect(linhasDaTabela()).toHaveLength(2);
  });

  it("depois de remover a única pessoa da última página, volta para a página anterior", async () => {
    await abrir(pessoas(21));
    fireEvent.click(screen.getByText("Próxima"));
    expect(linhasDaTabela()).toHaveLength(1);
    expect(nomesNaTabela()[0]).toContain("Pessoa 21");

    listUsers.mockResolvedValue(pessoas(20));
    fireEvent.click(within(linha("Pessoa 21")).getByLabelText("Mais opcoes"));
    fireEvent.click(screen.getByRole("button", { name: "Remover membro" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(21));
    await waitFor(() => expect(intervalo()).toBe("1-20 de 20"));
    expect(linhasDaTabela()).toHaveLength(20);
  });
});

describe("MembersTab - quadrado de grupos", () => {
  it("quem está no padrão e em mais um grupo mostra só o outro grupo", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS])]);

    const quadrado = gruposDe("Pessoa 02");

    expect(quadrado.querySelector(".groups-cell-label")?.textContent).toBe("Dados");
    expect(quadrado.textContent).not.toContain("Todos os usuários");
    expect(quadrado.querySelector(".groups-cell-extra")).toBeNull();
  });

  it("a dica do quadrado lista todos os grupos, inclusive o padrão escondido", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS, DIRETORIA])]);

    expect(gruposDe("Pessoa 02").getAttribute("title")).toBe("Todos os usuários, Dados, Diretoria");
  });

  it("com mais de um grupo além do padrão mostra o primeiro e o +N", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS, DIRETORIA, FINANCEIRO])]);

    const quadrado = gruposDe("Pessoa 02");

    expect(quadrado.querySelector(".groups-cell-label")?.textContent).toBe("Dados");
    expect(quadrado.querySelector(".groups-cell-extra")?.textContent).toBe("+2");
  });

  it("quem está só no padrão mostra o padrão, em cinza", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO])]);

    const quadrado = gruposDe("Pessoa 02");

    expect(quadrado.querySelector(".groups-cell-label")?.textContent).toBe("Todos os usuários");
    expect(quadrado.className).toContain("groups-cell-trigger-muted");
  });

  it("quem tem um grupo de verdade não fica em cinza", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS])]);

    expect(gruposDe("Pessoa 02").className).not.toContain("groups-cell-trigger-muted");
  });

  it("sem grupo nenhum mostra Nenhum grupo", async () => {
    await abrir([pessoa(1), pessoa(2, [])]);

    expect(gruposDe("Pessoa 02").querySelector(".groups-cell-label")?.textContent).toBe("Nenhum grupo");
  });

  it("todos os quadrados têm a mesma estrutura, para o CSS dar o mesmo tamanho a todos", async () => {
    await abrir([
      pessoa(1, [PADRAO]),
      pessoa(2, [PADRAO, DADOS]),
      pessoa(3, [PADRAO, FINANCEIRO, DADOS]),
      pessoa(4, []),
    ]);

    const quadrados = Array.from(document.querySelectorAll<HTMLElement>(".groups-cell-trigger"));
    expect(quadrados).toHaveLength(4);
    for (const quadrado of quadrados) {
      expect(quadrado.querySelector(".groups-cell-label")).not.toBeNull();
      expect(quadrado.querySelector(".groups-cell-caret")).not.toBeNull();
      // O tamanho vem só da classe (CSS), nunca de um estilo escrito em cada quadrado
      expect(quadrado.getAttribute("style")).toBeNull();
    }
  });

  it("o nome do quadrado para o leitor de tela diz de quem é e o que mostra", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS, DIRETORIA])]);

    expect(screen.getByRole("button", { name: "Grupos de Pessoa 02: Dados e mais 1" })).toBeTruthy();
  });

  it("clicar abre a lista com todos os grupos, o padrão marcado e travado", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS])]);

    fireEvent.click(gruposDe("Pessoa 02"));

    // O nome do grupo padrão também aparece na nota explicativa: aqui vale só a lista aberta
    const lista = within(document.querySelector(".groups-cell-dropdown") as HTMLElement);
    const padrao = lista.getByLabelText(/Todos os usuários/) as HTMLInputElement;
    expect(padrao.checked).toBe(true);
    expect(padrao.disabled).toBe(true);
    expect((lista.getByLabelText(/^Dados/) as HTMLInputElement).checked).toBe(true);
    expect((lista.getByLabelText(/^Diretoria/) as HTMLInputElement).checked).toBe(false);
    expect(lista.getByText("padrão")).toBeTruthy();
  });

  it("marcar um grupo na lista adiciona a pessoa a ele", async () => {
    await abrir([pessoa(1), pessoa(2, [PADRAO])]);
    fireEvent.click(gruposDe("Pessoa 02"));

    fireEvent.click(screen.getByLabelText(/^Diretoria/));

    await waitFor(() => expect(addGroupMember).toHaveBeenCalledWith(30, "pessoa2@exemplo.com"));
  });

  it("o convite pendente mostra o grupo convidado, e o padrão só quando não há outro", async () => {
    await abrir([pessoa(1)], [convite("novo@exemplo.com", DADOS, 1), convite("outro@exemplo.com", PADRAO, 2)]);

    expect(gruposDe("novo@exemplo.com").querySelector(".groups-cell-label")?.textContent).toBe("Dados");
    expect(gruposDe("outro@exemplo.com").querySelector(".groups-cell-label")?.textContent).toBe("Todos os usuários");
    expect(gruposDe("outro@exemplo.com").className).toContain("groups-cell-trigger-muted");
  });

  it("explica por que o grupo padrão some da coluna", async () => {
    await abrir([pessoa(1)]);

    expect(screen.getByText(/é o grupo padrão de todas as pessoas, por isso só aparece na coluna Grupos/)).toBeTruthy();
  });
});

describe("MembersTab - menu dos 3 pontinhos", () => {
  const abrirMenu = (texto: string) => fireEvent.click(within(linha(texto)).getByLabelText("Mais opcoes"));
  const icone = (botao: HTMLElement) => botao.querySelector(".material-symbols-outlined");

  it("Gerar link e Remover membro têm ícone, escondido do leitor de tela", async () => {
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenu("Pessoa 02");

    const gerar = screen.getByRole("button", { name: "Gerar link de redefinição" });
    const remover = screen.getByRole("button", { name: "Remover membro" });

    expect(icone(gerar)?.textContent).toBe("link");
    expect(icone(remover)?.textContent).toBe("person_remove");
    expect(icone(gerar)?.getAttribute("aria-hidden")).toBe("true");
    expect(icone(remover)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("as opções usam o layout com ícone e Remover continua em vermelho", async () => {
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenu("Pessoa 02");

    const gerar = screen.getByRole("button", { name: "Gerar link de redefinição" });
    const remover = screen.getByRole("button", { name: "Remover membro" });

    expect(gerar.className).toContain("kebab-menu-item-with-icon");
    expect(remover.className).toContain("kebab-menu-item-with-icon");
    expect(remover.className).toContain("kebab-menu-item-danger");
    expect(gerar.className).not.toContain("kebab-menu-item-danger");
  });

  it("a própria pessoa logada não tem a opção de se remover, mas pode gerar o link", async () => {
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenu("Pessoa 01");

    expect(screen.getByRole("button", { name: "Gerar link de redefinição" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remover membro" })).toBeNull();
  });

  it("o convite pendente tem Cancelar convite com ícone", async () => {
    await abrir([pessoa(1)], [convite("novo@exemplo.com", DADOS)]);
    abrirMenu("novo@exemplo.com");

    const cancelar = screen.getByRole("button", { name: "Cancelar convite" });

    expect(icone(cancelar)?.textContent).toBe("close");
    expect(cancelar.className).toContain("kebab-menu-item-danger");
  });

  it("Gerar link de redefinição abre a janela com o link", async () => {
    generateResetLink.mockResolvedValue({ token: "abc123", expires_in_minutes: 30 });
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenu("Pessoa 02");

    fireEvent.click(screen.getByRole("button", { name: "Gerar link de redefinição" }));

    expect(await screen.findByText("Link de redefinição gerado")).toBeTruthy();
    expect(generateResetLink).toHaveBeenCalledWith(2);
  });

  it("Remover membro pede confirmação antes e só então remove", async () => {
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenu("Pessoa 02");

    fireEvent.click(screen.getByRole("button", { name: "Remover membro" }));
    expect(screen.getByText(/Remover Pessoa 02 do sistema\?/)).toBeTruthy();
    expect(deleteUser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(2));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Membro removido."));
  });
});

describe("MembersTab - adicionar membro com grupos", () => {
  const ADMIN: UserGroup = { id: 5, name: "Administradores", is_default: false, is_admin_group: true };

  async function abrirJanela(users = [pessoa(1)]) {
    listGroups.mockResolvedValue([PADRAO, DADOS, DIRETORIA, ADMIN] as never);
    await abrir(users);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));
    await screen.findByText("Adicionar membro", { selector: "h2, h3, [role=dialog] *" });
  }

  const emailDaJanela = () => screen.getByPlaceholderText("pessoa@empresa.com") as HTMLInputElement;
  const seletorDeGrupos = () => screen.getByRole("button", { name: /^Grupos de a nova pessoa/ }) as HTMLButtonElement;
  // Os grupos ficam numa lista suspensa: ela só existe depois de clicar no seletor. Abre se ainda estiver fechada.
  const listaDeGrupos = () => {
    if (!document.querySelector(".groups-cell-dropdown-inline")) fireEvent.click(seletorDeGrupos());
    return within(document.querySelector(".groups-cell-dropdown-inline") as HTMLElement);
  };
  const adicionar = () => fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
  const preencher = (email = "nova@exemplo.com") => fireEvent.change(emailDaJanela(), { target: { value: email } });

  it("os grupos ficam recolhidos numa lista suspensa: só o seletor aparece, com o grupo padrão em cinza", async () => {
    await abrirJanela();

    expect(document.querySelector(".groups-cell-dropdown-inline")).toBeNull();
    expect(screen.queryByLabelText(/^Dados/)).toBeNull();
    const seletor = seletorDeGrupos();
    expect(seletor.querySelector(".groups-cell-label")?.textContent).toBe("Todos os usuários");
    expect(seletor.className).toContain("groups-cell-trigger-muted");
    expect(seletor.getAttribute("aria-expanded")).toBe("false");
  });

  it("o seletor é o mesmo quadrado de grupos da tabela, só que ocupa a largura toda da janela", async () => {
    await abrirJanela();

    expect(seletorDeGrupos().className).toContain("groups-cell-trigger");
    expect(seletorDeGrupos().className).toContain("groups-cell-trigger-block");
    expect(seletorDeGrupos().querySelector(".groups-cell-caret")).not.toBeNull();
  });

  it("clicar no seletor abre a lista no fluxo da janela, e clicar de novo fecha", async () => {
    await abrirJanela();

    fireEvent.click(seletorDeGrupos());
    expect(seletorDeGrupos().getAttribute("aria-expanded")).toBe("true");
    const lista = document.querySelector(".groups-cell-dropdown-inline") as HTMLElement;
    expect(lista).not.toBeNull();
    // A lista flutuante (a da tabela) não é usada aqui: ela ficaria cortada na borda da janela
    expect(lista.className).toContain("groups-cell-dropdown");

    fireEvent.click(seletorDeGrupos());
    expect(document.querySelector(".groups-cell-dropdown-inline")).toBeNull();
  });

  it("o seletor mostra o primeiro grupo marcado e o +N, como na tabela, e a dica lista todos", async () => {
    await abrirJanela();

    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));
    expect(seletorDeGrupos().querySelector(".groups-cell-label")?.textContent).toBe("Dados");
    expect(seletorDeGrupos().querySelector(".groups-cell-extra")).toBeNull();
    expect(seletorDeGrupos().className).not.toContain("groups-cell-trigger-muted");

    fireEvent.click(listaDeGrupos().getByLabelText(/^Diretoria/));
    expect(seletorDeGrupos().querySelector(".groups-cell-extra")?.textContent).toBe("+1");
    expect(seletorDeGrupos().getAttribute("title")).toBe("Todos os usuários, Dados, Diretoria");
    expect(screen.getByRole("button", { name: "Grupos de a nova pessoa: Dados e mais 1" })).toBeTruthy();
  });

  it("desmarcar tudo volta o seletor ao grupo padrão em cinza", async () => {
    await abrirJanela();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    expect(seletorDeGrupos().querySelector(".groups-cell-label")?.textContent).toBe("Todos os usuários");
    expect(seletorDeGrupos().className).toContain("groups-cell-trigger-muted");
  });

  it("a lista de grupos: o padrão marcado e travado, os outros livres", async () => {
    await abrirJanela();

    const lista = listaDeGrupos();
    const padrao = lista.getByLabelText(/Todos os usuários/) as HTMLInputElement;
    expect(padrao.checked).toBe(true);
    expect(padrao.disabled).toBe(true);
    for (const nome of [/^Dados/, /^Diretoria/, /^Administradores/]) {
      const caixa = lista.getByLabelText(nome) as HTMLInputElement;
      expect(caixa.checked).toBe(false);
      expect(caixa.disabled).toBe(false);
    }
    expect(lista.getByText("padrão")).toBeTruthy();
    expect(lista.getByText("admin")).toBeTruthy();
  });

  it("explica que o grupo padrão é automático e que o convite também vale para os grupos marcados", async () => {
    await abrirJanela();

    const dica = screen.getByText(/é automático para todas as pessoas/);
    expect(dica.textContent).toContain("Todos os usuários");
    expect(dica.textContent).toContain("quando se cadastrar");
  });

  it("sem marcar grupo nenhum entra só no padrão, como antes", async () => {
    await abrirJanela();
    preencher();

    adicionar();

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledTimes(1));
    expect(inviteGroupMember).toHaveBeenCalledWith(10, "nova@exemplo.com");
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Membro adicionado."));
    await waitFor(() => expect(screen.queryByPlaceholderText("pessoa@empresa.com")).toBeNull());
  });

  it("marcando grupos, o padrão vai primeiro e depois cada grupo escolhido, na ordem da lista", async () => {
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Diretoria/));
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    adicionar();

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledTimes(3));
    expect(inviteGroupMember).toHaveBeenNthCalledWith(1, 10, "nova@exemplo.com");
    expect(inviteGroupMember).toHaveBeenNthCalledWith(2, 20, "nova@exemplo.com");
    expect(inviteGroupMember).toHaveBeenNthCalledWith(3, 30, "nova@exemplo.com");
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Membro adicionado. Grupos: Dados, Diretoria."));
  });

  it("desmarcar um grupo antes de enviar tira ele da lista", async () => {
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    adicionar();

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledTimes(1));
    expect(inviteGroupMember).not.toHaveBeenCalledWith(20, expect.anything());
  });

  it("o grupo de administradores também pode ser escolhido", async () => {
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Administradores/));

    adicionar();

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledWith(5, "nova@exemplo.com"));
  });

  it("pessoa sem conta vira convite pendente nos grupos escolhidos, e o aviso diz isso", async () => {
    inviteGroupMember.mockResolvedValue({ status: "invited", email: "nova@exemplo.com" });
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    adicionar();

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Convite criado. A pessoa entra automaticamente quando se cadastrar. Grupos: Dados.",
      ),
    );
  });

  it("depois de adicionar, a lista de pessoas é recarregada", async () => {
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));
    const chamadasAntes = listUsers.mock.calls.length;

    adicionar();

    await waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(chamadasAntes));
  });

  it("se o grupo padrão falhar no servidor, mostra o erro na janela e não tenta os outros grupos", async () => {
    inviteGroupMember.mockRejectedValue({ response: { data: { detail: "Esse e-mail não pode ser convidado" } } });
    await abrirJanela();
    preencher("bloqueado@exemplo.com");
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    adicionar();

    expect(await screen.findByText("Esse e-mail não pode ser convidado")).toBeTruthy();
    expect(inviteGroupMember).toHaveBeenCalledTimes(1);
    // A janela continua aberta, com o que foi digitado e marcado
    expect((listaDeGrupos().getByLabelText(/^Dados/) as HTMLInputElement).checked).toBe(true);
    expect(emailDaJanela().value).toBe("bloqueado@exemplo.com");
  });

  it("sem uma mensagem do servidor mostra um erro padrão", async () => {
    inviteGroupMember.mockRejectedValue(new Error("rede"));
    await abrirJanela();
    preencher();

    adicionar();

    expect(await screen.findByText("Não foi possível adicionar o membro.")).toBeTruthy();
  });

  it("e-mail fora do formato não chega a ser enviado", async () => {
    await abrirJanela();
    preencher("errado");

    adicionar();

    expect(inviteGroupMember).not.toHaveBeenCalled();
  });

  it("se só um grupo extra falhar, a pessoa já foi adicionada: avisa qual falhou e fecha a janela", async () => {
    inviteGroupMember.mockImplementation(async (groupId) => {
      if (groupId === 20) throw new Error("falhou");
      return { status: "added", email: "nova@exemplo.com" };
    });
    await abrirJanela();
    preencher();
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));
    fireEvent.click(listaDeGrupos().getByLabelText(/^Diretoria/));

    adicionar();

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Membro adicionado, mas não foi possível incluir nos grupos: Dados. Use a coluna Grupos para tentar de novo.",
        "error",
      ),
    );
    // O outro grupo foi tentado mesmo assim
    expect(inviteGroupMember).toHaveBeenCalledWith(30, "nova@exemplo.com");
    expect(screen.queryByPlaceholderText("pessoa@empresa.com")).toBeNull();
  });

  it("enquanto grava, o botão mostra Adicionando e o seletor de grupos fica desligado", async () => {
    let terminar: () => void = () => undefined;
    inviteGroupMember.mockImplementation(
      () => new Promise((resolve) => (terminar = () => resolve({ status: "added", email: "nova@exemplo.com" }))),
    );
    await abrirJanela();
    preencher();

    adicionar();

    expect(await screen.findByText("Adicionando...")).toBeTruthy();
    expect(seletorDeGrupos().disabled).toBe(true);
    terminar();
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
  });

  it("cancelar fecha a janela, e ao abrir de novo o e-mail e os grupos estão limpos", async () => {
    await abrirJanela();
    preencher("alguem@exemplo.com");
    fireEvent.click(listaDeGrupos().getByLabelText(/^Dados/));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByPlaceholderText("pessoa@empresa.com")).toBeNull();
    expect(inviteGroupMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));
    expect(emailDaJanela().value).toBe("");
    // A lista volta fechada, com o seletor no grupo padrão, e nada ficou marcado
    expect(document.querySelector(".groups-cell-dropdown-inline")).toBeNull();
    expect(seletorDeGrupos().querySelector(".groups-cell-label")?.textContent).toBe("Todos os usuários");
    expect((listaDeGrupos().getByLabelText(/^Dados/) as HTMLInputElement).checked).toBe(false);
  });
});

describe("MembersTab - textos", () => {
  it("os textos da aba têm acento", async () => {
    await abrir([pessoa(1)]);

    expect(screen.getByText("Último acesso")).toBeTruthy();
    expect(screen.getByText("E-mail")).toBeTruthy();
    expect(screen.getByText("(você)")).toBeTruthy();
    expect(screen.getByText(/Aqui você define a quais grupos/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Filtrar por nome ou e-mail...")).toBeTruthy();
  });

  it("falha ao carregar avisa o erro", async () => {
    listUsers.mockRejectedValue(new Error("falhou"));
    listInvites.mockResolvedValue([]);
    render(<MembersTab />);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível carregar os membros.", "error"));
  });
});
