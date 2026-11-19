import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as accessApi from "../../api/access";
import * as groupsApi from "../../api/groups";
import * as usersApi from "../../api/users";
import * as workspacesApi from "../../api/workspaces";
import type { PendingInvite, UserDirectoryEntry, UserGroup } from "../../api/users";
import { ADMIN_ACCESS, AccessContext, buildAccess } from "../../context/AccessContext";
import UsersPanel from "./UsersPanel";

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), me: null as unknown as accessApi.MyAccess }));

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
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addGroupMember: vi.fn(),
  removeGroupMember: vi.fn(),
  inviteGroupMember: vi.fn(),
  cancelGroupInvite: vi.fn(),
}));
vi.mock("../../api/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/access")>()),
  getAccessCatalog: vi.fn(),
  getAccessReport: vi.fn(),
  listGroupsGrants: vi.fn(),
  getGrants: vi.fn(),
  setGrants: vi.fn(),
  grantByEmail: vi.fn(),
}));
vi.mock("../../api/workspaces", () => ({ listAllWorkspaces: vi.fn() }));

const getCatalog = vi.mocked(accessApi.getAccessCatalog);
const getReport = vi.mocked(accessApi.getAccessReport);
const grantByEmail = vi.mocked(accessApi.grantByEmail);
const listGroupsGrants = vi.mocked(accessApi.listGroupsGrants);
const listWorkspaces = vi.mocked(workspacesApi.listAllWorkspaces);

const CATALOGO: accessApi.AccessCatalog = {
  permissions: [
    { key: "colecao.ver", label: "Ver a coleção", description: "Entrar na coleção.", scope: "workspace", section: "Coleção", feature: null, feature_label: null, feature_description: null, requires: [] },
    { key: "relatorio.excluir", label: "Excluir relatório", description: "Remover relatório.", scope: "workspace", section: "Relatórios", feature: null, feature_label: null, feature_description: null, requires: ["colecao.ver"] },
    { key: "ia.usar", label: "Usar o chat de IA", description: "Conversar com a IA.", scope: "global", section: "Inteligência artificial", feature: null, feature_label: null, feature_description: null, requires: [] },
  ],
  presets: { leitor: ["colecao.ver"], editor: ["colecao.ver", "relatorio.excluir"], administrador: ["colecao.ver", "relatorio.excluir"] },
};

const listUsers = vi.mocked(usersApi.listUsers);
const listInvites = vi.mocked(usersApi.listPendingInvites);
const generateResetLink = vi.mocked(usersApi.generateResetLink);
const deleteUser = vi.mocked(usersApi.deleteUser);
const listGroups = vi.mocked(groupsApi.listGroups);
const addGroupMember = vi.mocked(groupsApi.addGroupMember);
const inviteGroupMember = vi.mocked(groupsApi.inviteGroupMember);
const createGroup = vi.mocked(groupsApi.createGroup);
const updateGroup = vi.mocked(groupsApi.updateGroup);
const deleteGroup = vi.mocked(groupsApi.deleteGroup);
const removeGroupMember = vi.mocked(groupsApi.removeGroupMember);
const cancelGroupInvite = vi.mocked(groupsApi.cancelGroupInvite);

const PADRAO: UserGroup = { id: 10, name: "Todos os usuários", is_default: true, is_admin_group: false };
const DADOS: UserGroup = { id: 20, name: "Dados", is_default: false, is_admin_group: false };
const DIRETORIA: UserGroup = { id: 30, name: "Diretoria", is_default: false, is_admin_group: false };
const FINANCEIRO: UserGroup = { id: 40, name: "Financeiro com um nome bem comprido", is_default: false, is_admin_group: false };

const GRUPOS = [PADRAO, DADOS, DIRETORIA, FINANCEIRO];

/** Pessoa n (o id 1 é a pessoa logada). Por padrão só está no grupo padrão. */
function pessoa(n: number, groups: UserGroup[] = [PADRAO]): UserDirectoryEntry {
  const nome = `Pessoa ${String(n).padStart(2, "0")}`;
  return { id: n, name: nome, email: `pessoa${n}@exemplo.com`, groups, last_login: null };
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
  const resultado = render(
    <AccessContext.Provider value={buildAccess(mocks.me)}>
      <MemoryRouter>
        <UsersPanel />
      </MemoryRouter>
    </AccessContext.Provider>,
  );
  await screen.findByText("Pessoas, grupos e permissões");
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
  mocks.me = ADMIN_ACCESS;
  mocks.showToast.mockClear();
  for (const fn of [listUsers, listInvites, generateResetLink, deleteUser, listGroups, addGroupMember, inviteGroupMember, getCatalog, getReport, grantByEmail, listWorkspaces, listGroupsGrants]) fn.mockReset();
  listGroupsGrants.mockResolvedValue([]);
  getCatalog.mockResolvedValue(CATALOGO);
  getReport.mockResolvedValue([]);
  grantByEmail.mockResolvedValue({ status: "applied" });
  listWorkspaces.mockResolvedValue([{ id: 1, name: "Vendas" } as workspacesApi.Workspace]);
  listGroups.mockResolvedValue(GRUPOS as never);
  addGroupMember.mockResolvedValue(undefined as never);
  inviteGroupMember.mockResolvedValue({ status: "added", email: "nova@exemplo.com" });
  deleteUser.mockResolvedValue(undefined);
});

describe("UsersPanel - linhas por página", () => {
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

describe("UsersPanel - quadrado de grupos", () => {
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

    // O quadrado de permissões reaproveita o visual, mas é outra coluna: aqui só os de grupos
    const quadrados = Array.from(document.querySelectorAll<HTMLElement>(".groups-cell-trigger:not(.permissions-cell-trigger)"));
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

describe("UsersPanel - menu dos 3 pontinhos", () => {
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

describe("UsersPanel - adicionar membro com grupos", () => {
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

describe("UsersPanel - textos", () => {
  it("os textos da aba têm acento", async () => {
    await abrir([pessoa(1)]);

    expect(screen.getByText("Último acesso")).toBeTruthy();
    expect(screen.getByText("E-mail")).toBeTruthy();
    expect(screen.getByText("(você)")).toBeTruthy();
    expect(screen.getByText(/Veja e cuide de quem são as pessoas/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Filtrar por nome ou e-mail...")).toBeTruthy();
  });

  it("falha ao carregar avisa o erro", async () => {
    listUsers.mockRejectedValue(new Error("falhou"));
    listInvites.mockResolvedValue([]);
    render(
      <AccessContext.Provider value={buildAccess(mocks.me)}>
        <MemoryRouter>
          <UsersPanel />
        </MemoryRouter>
      </AccessContext.Provider>,
    );

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível carregar os membros.", "error"));
  });
});

const LINHA_DA_MARIA: accessApi.ReportRow = {
  user_id: 2,
  name: "Pessoa 02",
  email: "pessoa2@exemplo.com",
  is_admin: false,
  groups: [{ name: "Dados", is_default: false }],
  workspace_id: 1,
  scope_label: "Vendas",
  permissions: [
    { key: "colecao.ver", label: "Ver a coleção", groups: ["Dados"], direct: false },
    { key: "relatorio.excluir", label: "Excluir relatório", groups: [], direct: true },
  ],
};
const LINHA_GLOBAL_DA_MARIA: accessApi.ReportRow = {
  ...LINHA_DA_MARIA,
  workspace_id: null,
  scope_label: "Em todo o sistema",
  permissions: [{ key: "ia.usar", label: "Usar o chat de IA", groups: ["Dados"], direct: false }],
};
const LINHA_DO_ADMIN: accessApi.ReportRow = {
  user_id: 1,
  name: "Pessoa 01",
  email: "pessoa1@exemplo.com",
  is_admin: true,
  groups: [{ name: "Administradores", is_default: false }],
  workspace_id: null,
  scope_label: "Todo o sistema e todas as coleções",
  permissions: [],
};

describe("UsersPanel - permissões", () => {
  const caixaDePermissoes = (nome: string) => within(linha(nome)).getByText(/permiss/, { selector: ".groups-cell-label" }).closest(".permissions-summary") as HTMLElement;

  it("a coluna Permissões resume cada pessoa: todas, quantas, avulsa e nenhuma", async () => {
    // Quem não tem nada vem do servidor como uma linha sem permissões
    const semNada: accessApi.ReportRow = {
      ...LINHA_DA_MARIA,
      user_id: 3,
      name: "Pessoa 03",
      email: "pessoa3@exemplo.com",
      workspace_id: null,
      scope_label: "Sem nenhuma permissão",
      permissions: [],
    };
    getReport.mockResolvedValue([LINHA_DO_ADMIN, LINHA_DA_MARIA, LINHA_GLOBAL_DA_MARIA, semNada]);
    await abrir([pessoa(1), pessoa(2), pessoa(3)]);

    expect(caixaDePermissoes("Pessoa 01").textContent).toContain("Todas as permissões");
    const maria = caixaDePermissoes("Pessoa 02");
    expect(maria.querySelector(".groups-cell-label")?.textContent).toBe("3 permissões");
    expect(maria.querySelector(".groups-cell-extra")?.textContent).toBe("avulsa");
    expect(maria.title).toContain("Vendas: Ver a coleção, Excluir relatório");
    expect(caixaDePermissoes("Pessoa 03").textContent).toContain("Nenhuma permissão");
  });

  it("filtrar por permissão pede ao servidor e mostra só quem passa", async () => {
    getReport.mockImplementation(async (filters) => (filters.permission ? [LINHA_DA_MARIA] : []));
    await abrir([pessoa(1), pessoa(2), pessoa(3)]);

    fireEvent.change(screen.getByLabelText("Filtrar por permissão"), { target: { value: "relatorio.excluir" } });

    await waitFor(() => expect(nomesNaTabela().some((n) => n.includes("Pessoa 02"))).toBe(true));
    expect(nomesNaTabela().some((n) => n.includes("Pessoa 03"))).toBe(false);
    expect(getReport).toHaveBeenCalledWith(expect.objectContaining({ permission: "relatorio.excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(nomesNaTabela().some((n) => n.includes("Pessoa 03"))).toBe(true));
  });

  it("os convites pendentes somem nos filtros de permissão e ficam no filtro de grupo, só os do grupo", async () => {
    getReport.mockImplementation(async (filters) => (filters.group_id || filters.permission ? [LINHA_DA_MARIA] : []));
    await abrir([pessoa(1), pessoa(2)], [convite("novo@exemplo.com", DADOS, 1), convite("outro@exemplo.com", DIRETORIA, 2)]);

    fireEvent.change(screen.getByLabelText("Filtrar por grupo"), { target: { value: "20" } });
    await waitFor(() => expect(nomesNaTabela().some((n) => n.includes("outro@exemplo.com"))).toBe(false));
    expect(nomesNaTabela().some((n) => n.includes("novo@exemplo.com"))).toBe(true);

    fireEvent.change(screen.getByLabelText("Filtrar por permissão"), { target: { value: "ia.usar" } });
    await waitFor(() => expect(nomesNaTabela().some((n) => n.includes("novo@exemplo.com"))).toBe(false));
  });

  it("a coluna Permissões só informa: não é botão, a edição é só pelo menu dos três pontinhos", async () => {
    getReport.mockResolvedValue([LINHA_DA_MARIA]);
    await abrir([pessoa(1), pessoa(2)]);

    expect(within(linha("Pessoa 02")).queryByRole("button", { name: /^Editar permissões/ })).toBeNull();
    expect(caixaDePermissoes("Pessoa 02").tagName).toBe("SPAN");
  });

  it("Editar, no menu da pessoa, abre a edição com o que vem de grupo marcado e travado", async () => {
    getReport.mockResolvedValue([LINHA_DA_MARIA]);
    vi.mocked(accessApi.getGrants).mockResolvedValue({
      blocks: [{ workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }],
      editable: true,
    });
    await abrir([pessoa(1), pessoa(2)]);

    fireEvent.click(within(linha("Pessoa 02")).getByLabelText("Mais opcoes"));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar membro")).toBeTruthy();
    expect(vi.mocked(accessApi.getGrants)).toHaveBeenCalledWith("user", 2);
    const verColecao = (await screen.findByLabelText(/^Ver a coleção/)) as HTMLInputElement;
    expect(verColecao.checked).toBe(true);
    expect(verColecao.disabled).toBe(true);
    expect(screen.getByText(/Vem do grupo Dados/)).toBeTruthy();
    // O que é só da pessoa continua livre
    expect((screen.getByLabelText(/^Excluir relatório/) as HTMLInputElement).disabled).toBe(false);
  });
});

describe("UsersPanel - editar pelo menu e visão por grupo", () => {
  const abrirMenu = (texto: string) => fireEvent.click(within(linha(texto)).getByLabelText("Mais opcoes"));

  it("não há linha que expande: cada linha só tem o menu dos três pontinhos", async () => {
    await abrir([pessoa(1), pessoa(2)]);

    expect(screen.queryByRole("button", { name: /detalhes de/ })).toBeNull();
    expect(document.querySelector(".access-detail-row")).toBeNull();
  });

  it("Editar, no menu da pessoa, abre a janela com o cabeçalho: nome, e-mail, grupos e números", async () => {
    getReport.mockResolvedValue([LINHA_DA_MARIA, LINHA_GLOBAL_DA_MARIA]);
    vi.mocked(accessApi.getGrants).mockResolvedValue({ blocks: [], editable: true });
    await abrir([pessoa(1), pessoa(2, [PADRAO, DADOS])]);

    abrirMenu("Pessoa 02");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar membro")).toBeTruthy();
    const cabecalho = screen.getByRole("region", { name: "Resumo de Pessoa 02" });
    expect(within(cabecalho).getByText("pessoa2@exemplo.com")).toBeTruthy();
    // O grupo padrão é de todo mundo: só aparece o grupo de verdade
    expect(within(cabecalho).getByText("Dados")).toBeTruthy();
    expect(within(cabecalho).queryByText("Todos os usuários")).toBeNull();
    expect(within(cabecalho).getByText("3")).toBeTruthy();
    expect(within(cabecalho).getByText("Sim")).toBeTruthy();
    expect(within(cabecalho).getByText("Nunca acessou")).toBeTruthy();
  });

  it("as permissões da janela são uma lista de interruptores, um embaixo do outro", async () => {
    vi.mocked(accessApi.getGrants).mockResolvedValue({
      blocks: [
        { workspace_id: null, permissions: ["ia.usar"] },
        { workspace_id: 1, permissions: ["colecao.ver"] },
      ],
      editable: true,
    });
    await abrir([pessoa(1), pessoa(2)]);

    abrirMenu("Pessoa 02");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    // As seções vêm fechadas, cada uma com quantas permissões tem ligadas
    fireEvent.click(await screen.findByRole("button", { name: "Expandir tudo" }));
    const interruptor = (await screen.findByRole("switch", { name: "Usar o chat de IA" })) as HTMLInputElement;
    expect(interruptor.checked).toBe(true);
    expect(interruptor.closest(".toggle-switch")).not.toBeNull();
    expect(document.querySelectorAll(".access-row").length).toBeGreaterThan(1);
    // Dentro do editor não sobra nenhuma caixinha comum: tudo é interruptor
    expect(document.querySelector(".access-editor input[type=checkbox]:not([role=switch])")).toBeNull();
  });

  const GRUPOS_COM_PERMISSOES: accessApi.GroupGrants[] = [
    { group_id: 10, blocks: [], editable: true },
    { group_id: 20, blocks: [{ workspace_id: null, permissions: ["ia.usar"] }, { workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }], editable: true },
    { group_id: 30, blocks: [], editable: true },
  ];

  async function abrirPorGrupo() {
    listGroupsGrants.mockResolvedValue(GRUPOS_COM_PERMISSOES);
    listGroups.mockResolvedValue([PADRAO, DADOS, DIRETORIA] as never);
    await abrir([pessoa(1, [PADRAO, DADOS]), pessoa(2, [PADRAO]), pessoa(3, [PADRAO, DADOS, DIRETORIA])]);
    fireEvent.click(screen.getByRole("button", { name: "Por grupo" }));
  }
  const linhaDoGrupo = (nome: string) => screen.getByText(nome, { selector: "strong" }).closest("tr") as HTMLElement;

  it("a alternância troca a tabela de pessoas pela de grupos e volta", async () => {
    await abrirPorGrupo();

    expect(screen.getByRole("button", { name: "Por grupo" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Grupo", { selector: "th" })).toBeTruthy();
    expect(screen.queryByLabelText("Filtrar por permissão")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Por membro" }));
    expect(screen.getByText("Nome", { selector: "th" })).toBeTruthy();
  });

  it("cada grupo mostra quantas pessoas tem e o resumo do que dá", async () => {
    await abrirPorGrupo();

    expect(linhaDoGrupo("Dados").textContent).toContain("2 pessoas");
    expect(linhaDoGrupo("Dados").querySelector(".permissions-summary")?.textContent).toContain("3 permissões");
    expect(linhaDoGrupo("Diretoria").textContent).toContain("1 pessoa");
    expect(linhaDoGrupo("Diretoria").textContent).toContain("Nenhuma permissão");
    expect(linhaDoGrupo("Todos os usuários").textContent).toContain("3 pessoas");
    expect(linhaDoGrupo("Todos os usuários").textContent).toContain("padrão");
  });

  it("a busca filtra os grupos pelo nome", async () => {
    await abrirPorGrupo();

    fireEvent.change(screen.getByLabelText("Filtrar grupos por nome"), { target: { value: "dir" } });

    expect(screen.queryByText("Dados", { selector: "strong" })).toBeNull();
    expect(screen.getByText("Diretoria", { selector: "strong" })).toBeTruthy();
  });

  it("Editar, no menu do grupo, abre a janela com quem está nele e os números do grupo", async () => {
    vi.mocked(accessApi.getGrants).mockResolvedValue({ blocks: [{ workspace_id: null, permissions: ["ia.usar"] }], editable: true });
    await abrirPorGrupo();

    fireEvent.click(within(linhaDoGrupo("Dados")).getByLabelText("Mais opcoes"));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar grupo")).toBeTruthy();
    expect(vi.mocked(accessApi.getGrants)).toHaveBeenCalledWith("group", 20);
    const cabecalho = screen.getByRole("region", { name: "Resumo de Dados" });
    expect(within(cabecalho).getByText("Pessoa 01")).toBeTruthy();
    expect(within(cabecalho).getByText("Pessoa 03")).toBeTruthy();
    expect(within(cabecalho).queryByText("Pessoa 02")).toBeNull();
    // Pessoas, permissões e coleções com permissão
    const numeros = Array.from(cabecalho.querySelectorAll("dd")).map((dd) => dd.textContent);
    expect(numeros).toEqual(["2", "3", "1"]);
  });

  it("o resumo de permissões do grupo não é botão: editar é só pelo menu", async () => {
    await abrirPorGrupo();

    expect(within(linhaDoGrupo("Dados")).queryByRole("button", { name: /^Editar permissões/ })).toBeNull();
    // Só o menu dos três pontinhos na linha
    expect(within(linhaDoGrupo("Dados")).getAllByRole("button")).toHaveLength(1);
  });
});

describe("UsersPanel - adicionar membro com permissões", () => {
  async function abrirJanelaDeAdicionar() {
    await abrir([pessoa(1)]);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));
    return screen.findByPlaceholderText("pessoa@empresa.com");
  }
  const enviar = () => fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

  it("sem marcar permissão nenhuma, não chama a API de permissões", async () => {
    const email = await abrirJanelaDeAdicionar();
    fireEvent.change(email, { target: { value: "nova@exemplo.com" } });

    enviar();

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Membro adicionado."));
    expect(grantByEmail).not.toHaveBeenCalled();
  });

  it("as permissões marcadas vão para o e-mail depois dos grupos e o aviso confirma", async () => {
    const email = await abrirJanelaDeAdicionar();
    fireEvent.change(email, { target: { value: "nova@exemplo.com" } });
    fireEvent.click(screen.getByLabelText(/^Usar o chat de IA/));

    enviar();

    await waitFor(() =>
      expect(grantByEmail).toHaveBeenCalledWith("nova@exemplo.com", [{ workspace_id: null, permissions: ["ia.usar"] }]),
    );
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Membro adicionado. Permissões salvas."));
    expect(inviteGroupMember).toHaveBeenCalledWith(10, "nova@exemplo.com");
  });

  it("uma coleção entra com ver e leva o atalho escolhido", async () => {
    const email = await abrirJanelaDeAdicionar();
    fireEvent.change(email, { target: { value: "nova@exemplo.com" } });
    fireEvent.change(screen.getByLabelText("Coleção para adicionar"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar coleção" }));
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));

    enviar();

    await waitFor(() =>
      expect(grantByEmail).toHaveBeenCalledWith("nova@exemplo.com", [
        { workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] },
      ]),
    );
  });

  it("se as permissões falharem, a pessoa já foi adicionada e o aviso diz o que corrigir", async () => {
    inviteGroupMember.mockResolvedValue({ status: "invited", email: "nova@exemplo.com" });
    grantByEmail.mockRejectedValue(new Error("falhou"));
    const email = await abrirJanelaDeAdicionar();
    fireEvent.change(email, { target: { value: "nova@exemplo.com" } });
    fireEvent.click(screen.getByLabelText(/^Usar o chat de IA/));

    enviar();

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Convite criado, mas não foi possível gravar as permissões. Corrija pelas colunas Grupos e Permissões.",
        "error",
      ),
    );
    await waitFor(() => expect(screen.queryByPlaceholderText("pessoa@empresa.com")).toBeNull());
  });

  it("cancelar e abrir de novo mostra as permissões limpas", async () => {
    const email = await abrirJanelaDeAdicionar();
    fireEvent.change(email, { target: { value: "nova@exemplo.com" } });
    fireEvent.click(screen.getByLabelText(/^Usar o chat de IA/));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));

    expect(((await screen.findByLabelText(/^Usar o chat de IA/)) as HTMLInputElement).checked).toBe(false);
  });
});

describe("UsersPanel - cada acao pela sua permissao", () => {
  // Quem abre a aba tem "ver membros"; o resto vem dos itens escolhidos em cada teste
  const como = (...globais: string[]) => {
    mocks.me = { is_admin: false, global_permissions: ["membros.ver", ...globais], workspace_permissions: {} };
  };
  const abrirMenuDe = (nome: string) => fireEvent.click(within(linha(nome)).getByLabelText("Mais opcoes"));
  const botao = (nome: string) => screen.queryByRole("button", { name: nome });

  it("so ver os membros: sem Adicionar membro, grupos travados e menu so com Ver permissoes", async () => {
    como();
    await abrir([pessoa(1), pessoa(2)]);

    expect(botao("+ Adicionar membro")).toBeNull();
    expect((gruposDe("Pessoa 02") as HTMLButtonElement).disabled).toBe(true);
    abrirMenuDe("Pessoa 02");
    expect(botao("Ver permissões")).not.toBeNull();
    expect(botao("Editar")).toBeNull();
    expect(botao("Gerar link de redefinição")).toBeNull();
    expect(botao("Remover membro")).toBeNull();
  });

  it("membros.adicionar mostra o botao de adicionar", async () => {
    como("membros.adicionar");
    await abrir([pessoa(1)]);

    expect(botao("+ Adicionar membro")).not.toBeNull();
  });

  it("membros.senha mostra Gerar link de redefinicao", async () => {
    como("membros.senha");
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenuDe("Pessoa 02");

    expect(botao("Gerar link de redefinição")).not.toBeNull();
    expect(botao("Remover membro")).toBeNull();
  });

  it("membros.remover mostra Remover membro nas outras pessoas, nunca na propria conta", async () => {
    como("membros.remover");
    await abrir([pessoa(1), pessoa(2)]);

    abrirMenuDe("Pessoa 02");
    expect(botao("Remover membro")).not.toBeNull();
    expect(botao("Gerar link de redefinição")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    abrirMenuDe("Pessoa 01");
    expect(botao("Remover membro")).toBeNull();
  });

  it.each(["membros.editar", "grupos.participantes"])("%s libera mudar os grupos de uma pessoa", async (item) => {
    como(item);
    await abrir([pessoa(1), pessoa(2)]);

    expect((gruposDe("Pessoa 02") as HTMLButtonElement).disabled).toBe(false);
  });

  it("permissoes.editar troca Ver permissoes por Editar e abre a janela com o Salvar disponivel", async () => {
    como("permissoes.editar");
    vi.mocked(accessApi.getGrants).mockResolvedValue({ blocks: [{ workspace_id: null, permissions: ["ia.usar"] }], editable: true });
    getCatalog.mockResolvedValue(CATALOGO);
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenuDe("Pessoa 02");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Editar membro")).toBeTruthy();
    await screen.findByLabelText("Pesquisar permissões");
    expect(screen.queryByText(/não tem a permissão de dar ou tirar permissões/)).toBeNull();
  });

  it("sem permissoes.editar a janela abre so para ver, com aviso e sem poder mudar", async () => {
    como();
    vi.mocked(accessApi.getGrants).mockResolvedValue({ blocks: [{ workspace_id: null, permissions: ["ia.usar"] }], editable: true });
    getCatalog.mockResolvedValue(CATALOGO);
    await abrir([pessoa(1), pessoa(2)]);
    abrirMenuDe("Pessoa 02");
    fireEvent.click(screen.getByRole("button", { name: "Ver permissões" }));

    expect(await screen.findByText(/não tem a permissão de dar ou tirar permissões/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expandir tudo" }));
    // Travado pelo conjunto inteiro (fieldset desabilitado), nao so pelo interruptor
    expect(screen.getByRole("switch", { name: "Usar o chat de IA" }).matches(":disabled")).toBe(true);
    expect(botao("Salvar permissões")).toBeNull();
  });

  it("convite pendente: so quem pode gerenciar convites ve o menu de cancelar e mexe nos grupos", async () => {
    como("membros.adicionar");
    await abrir([pessoa(1)], [convite("novo@exemplo.com", DADOS)]);
    expect(within(linha("novo@exemplo.com")).queryByLabelText("Mais opcoes")).toBeNull();
    expect((gruposDe("novo@exemplo.com") as HTMLButtonElement).disabled).toBe(true);
  });

  it("com membros.convites o convite pendente ganha o menu de cancelar", async () => {
    como("membros.convites", "membros.adicionar");
    await abrir([pessoa(1)], [convite("novo@exemplo.com", DADOS)]);

    abrirMenuDe("novo@exemplo.com");
    expect(botao("Cancelar convite")).not.toBeNull();
    expect((gruposDe("novo@exemplo.com") as HTMLButtonElement).disabled).toBe(false);
  });

  it("na janela de adicionar, as permissoes adicionais so aparecem para quem pode dar permissoes", async () => {
    como("membros.adicionar");
    getCatalog.mockResolvedValue(CATALOGO);
    await abrir([pessoa(1)]);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));
    await screen.findByPlaceholderText("pessoa@empresa.com");
    expect(screen.queryByText("Permissões adicionais (opcional)")).toBeNull();

    document.body.innerHTML = "";
    como("membros.adicionar", "permissoes.editar");
    await abrir([pessoa(1)]);
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar membro" }));
    expect(await screen.findByText("Permissões adicionais (opcional)")).toBeTruthy();
  });
});


describe("UsersPanel - gerenciar grupos (a antiga aba Grupos agora vive aqui)", () => {
  const GRUPO_ADMIN: UserGroup = { id: 5, name: "Administradores", is_default: false, is_admin_group: true };
  const GRUPOS_COM_PERMISSOES: accessApi.GroupGrants[] = [
    { group_id: 10, blocks: [], editable: true },
    { group_id: 20, blocks: [{ workspace_id: null, permissions: ["ia.usar"] }], editable: true },
    { group_id: 30, blocks: [], editable: true },
  ];
  const como = (...globais: string[]) => {
    mocks.me = { is_admin: false, global_permissions: ["membros.ver", "grupos.ver", ...globais], workspace_permissions: {} };
  };

  async function abrirPorGrupo(opcoes: { invites?: PendingInvite[] } = {}) {
    listGroupsGrants.mockResolvedValue(GRUPOS_COM_PERMISSOES);
    listGroups.mockResolvedValue([PADRAO, DADOS, DIRETORIA, GRUPO_ADMIN] as never);
    listUsers.mockResolvedValue([pessoa(1, [PADRAO, DADOS]), pessoa(2, [PADRAO]), pessoa(3, [PADRAO, DADOS, DIRETORIA])]);
    listInvites.mockResolvedValue(opcoes.invites ?? []);
    render(
      <AccessContext.Provider value={buildAccess(mocks.me)}>
        <MemoryRouter initialEntries={["/users"]}>
          <UsersPanel />
        </MemoryRouter>
      </AccessContext.Provider>,
    );
    await screen.findByText("Pessoas, grupos e permissões");
    fireEvent.click(screen.getByRole("button", { name: "Por grupo" }));
  }
  const linhaDoGrupo = (nome: string) => screen.getByText(nome, { selector: "strong" }).closest("tr") as HTMLElement;
  const abrirMenuDoGrupo = (nome: string) => fireEvent.click(within(linhaDoGrupo(nome)).getByLabelText("Mais opcoes"));
  const botao = (nome: string) => screen.queryByRole("button", { name: nome });

  beforeEach(() => {
    createGroup.mockReset().mockResolvedValue({ id: 99, name: "Novo", is_default: false, is_admin_group: false } as never);
    updateGroup.mockReset().mockResolvedValue({} as never);
    deleteGroup.mockReset().mockResolvedValue(undefined as never);
    removeGroupMember.mockReset().mockResolvedValue(undefined as never);
    cancelGroupInvite.mockReset().mockResolvedValue(undefined as never);
    inviteGroupMember.mockReset().mockResolvedValue({ status: "added", email: "x@y.com" } as never);
  });

  it("quem pode criar grupos ve o formulario, e criar chama a API, avisa e recarrega", async () => {
    await abrirPorGrupo();

    fireEvent.change(screen.getByLabelText("Nome do novo grupo"), { target: { value: "Financeiro" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith("Financeiro"));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Grupo criado."));
    // Recarregou a lista (uma vez ao abrir, outra depois de criar)
    await waitFor(() => expect(listGroups.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("falha ao criar mostra o erro do servidor", async () => {
    createGroup.mockRejectedValue({ response: { data: { detail: "Ja existe um grupo com esse nome" } } });
    await abrirPorGrupo();

    fireEvent.change(screen.getByLabelText("Nome do novo grupo"), { target: { value: "Dados" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }));

    expect(await screen.findByText("Ja existe um grupo com esse nome")).toBeTruthy();
  });

  it("sem a permissao de criar grupos o formulario nao aparece", async () => {
    como();
    await abrirPorGrupo();

    expect(screen.queryByLabelText("Nome do novo grupo")).toBeNull();
  });

  it("o menu de um grupo comum tem editar, adicionar membro, renomear e excluir", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Dados");

    for (const nome of ["Editar", "Adicionar/convidar membro", "Renomear", "Excluir grupo"]) {
      expect(botao(nome)).not.toBeNull();
    }
  });

  it("o grupo padrao so abre a edicao: nao renomeia, nao exclui e nao tem lista de participantes", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Todos os usuários");

    expect(botao("Editar")).not.toBeNull();
    expect(botao("Renomear")).toBeNull();
    expect(botao("Excluir grupo")).toBeNull();
    expect(botao("Adicionar/convidar membro")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    await screen.findByText("Editar grupo");
    expect(screen.queryByLabelText("Participantes do grupo")).toBeNull();
  });

  it("o grupo Administradores nao renomeia nem exclui, mas o administrador da plataforma coloca gente nele", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Administradores");

    expect(botao("Adicionar/convidar membro")).not.toBeNull();
    expect(botao("Renomear")).toBeNull();
    expect(botao("Excluir grupo")).toBeNull();
  });

  it("quem nao e administrador da plataforma nao mexe no grupo Administradores", async () => {
    como("grupos.participantes", "membros.adicionar", "grupos.editar", "grupos.excluir");
    await abrirPorGrupo();
    abrirMenuDoGrupo("Administradores");

    expect(botao("Adicionar/convidar membro")).toBeNull();
  });

  it("excluir pede confirmacao e so entao exclui o grupo certo", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Diretoria");
    fireEvent.click(screen.getByRole("button", { name: "Excluir grupo" }));
    expect(deleteGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith(30));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Grupo excluido."));
  });

  it("renomear abre a janela do grupo certo e grava o novo nome", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Renomear" }));

    const campo = await screen.findByDisplayValue("Dados");
    fireEvent.change(campo, { target: { value: "Dados e BI" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateGroup).toHaveBeenCalledWith(20, "Dados e BI"));
  });

  it("adicionar/convidar membro chama o convite do grupo certo", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar/convidar membro" }));

    fireEvent.change(await screen.findByPlaceholderText("Email para adicionar ou convidar"), { target: { value: "ana@exemplo.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^(Adicionar|Convidar)/ }));

    await waitFor(() => expect(inviteGroupMember).toHaveBeenCalledWith(20, "ana@exemplo.com"));
  });

  it("a janela do grupo lista os participantes e os convites pendentes dele, so os dele", async () => {
    await abrirPorGrupo({ invites: [convite("novo@exemplo.com", DADOS, 7), convite("outro@exemplo.com", DIRETORIA, 8)] });
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    const lista = within(await screen.findByLabelText("Participantes do grupo"));
    expect(lista.getByText("Pessoa 01")).toBeTruthy();
    expect(lista.getByText("Pessoa 03")).toBeTruthy();
    expect(lista.queryByText("Pessoa 02")).toBeNull();
    expect(lista.getByText("novo@exemplo.com")).toBeTruthy();
    expect(lista.queryByText("outro@exemplo.com")).toBeNull();
  });

  it("remover um participante pede confirmacao e remove a pessoa certa do grupo certo", async () => {
    await abrirPorGrupo();
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const lista = within(await screen.findByLabelText("Participantes do grupo"));

    fireEvent.click(lista.getAllByRole("button", { name: "Remover do grupo" })[1]);
    expect(removeGroupMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(removeGroupMember).toHaveBeenCalledWith(20, 3));
  });

  it("cancelar um convite do grupo chama a API do convite certo", async () => {
    await abrirPorGrupo({ invites: [convite("novo@exemplo.com", DADOS, 7)] });
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const lista = within(await screen.findByLabelText("Participantes do grupo"));

    fireEvent.click(lista.getByRole("button", { name: "Cancelar convite" }));

    await waitFor(() => expect(cancelGroupInvite).toHaveBeenCalledWith(20, 7));
  });

  it("sem permissao de tirar gente nem de cancelar convites, a lista so mostra", async () => {
    como();
    await abrirPorGrupo({ invites: [convite("novo@exemplo.com", DADOS, 7)] });
    abrirMenuDoGrupo("Dados");
    fireEvent.click(screen.getByRole("button", { name: "Ver permissões" }));
    const lista = within(await screen.findByLabelText("Participantes do grupo"));

    expect(lista.queryByRole("button", { name: "Remover do grupo" })).toBeNull();
    expect(lista.queryByRole("button", { name: "Cancelar convite" })).toBeNull();
    expect(lista.queryByRole("button", { name: /Adicionar/ })).toBeNull();
  });

  it("so ver os grupos: o menu so tem Ver permissoes", async () => {
    como();
    await abrirPorGrupo();
    abrirMenuDoGrupo("Dados");

    expect(botao("Ver permissões")).not.toBeNull();
    expect(botao("Renomear")).toBeNull();
    expect(botao("Excluir grupo")).toBeNull();
    expect(botao("Adicionar/convidar membro")).toBeNull();
  });
});

describe("UsersPanel - a visao por grupo na URL e por permissao", () => {
  const renderAt = async (url: string, globais: string[]) => {
    mocks.me = { is_admin: false, global_permissions: globais, workspace_permissions: {} };
    listUsers.mockResolvedValue([pessoa(1), pessoa(2)]);
    listInvites.mockResolvedValue([]);
    listGroups.mockResolvedValue([PADRAO, DADOS] as never);
    listGroupsGrants.mockResolvedValue([]);
    render(
      <AccessContext.Provider value={buildAccess(mocks.me)}>
        <MemoryRouter initialEntries={[url]}>
          <UsersPanel />
        </MemoryRouter>
      </AccessContext.Provider>,
    );
    await screen.findByText("Pessoas, grupos e permissões");
  };

  it("?view=groups abre direto na visao por grupo para quem pode ver os grupos", async () => {
    await renderAt("/users?view=groups", ["membros.ver", "grupos.ver"]);

    expect(screen.getByRole("button", { name: "Por grupo" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Grupo", { selector: "th" })).toBeTruthy();
  });

  it("quem so ve membros nao tem o botao Por grupo, e ?view=groups cai na visao por membro", async () => {
    await renderAt("/users?view=groups", ["membros.ver"]);

    expect(screen.queryByRole("button", { name: "Por grupo" })).toBeNull();
    expect(screen.getByText("Nome", { selector: "th" })).toBeTruthy();
  });

  it("quem so ve membros nao busca as permissoes dos grupos", async () => {
    listGroupsGrants.mockClear();
    await renderAt("/users", ["membros.ver"]);

    expect(listGroupsGrants).not.toHaveBeenCalled();
  });

  it("trocar de visao funciona nos dois sentidos", async () => {
    await renderAt("/users", ["membros.ver", "grupos.ver"]);

    fireEvent.click(screen.getByRole("button", { name: "Por grupo" }));
    expect(screen.getByRole("button", { name: "Por grupo" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Por membro" }));
    expect(screen.getByRole("button", { name: "Por membro" }).getAttribute("aria-pressed")).toBe("true");
  });
});
