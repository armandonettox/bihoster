import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as accessApi from "../api/access";
import * as workspacesApi from "../api/workspaces";
import AccessEditor from "./AccessEditor";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/access")>()),
  getAccessCatalog: vi.fn(),
  getGrants: vi.fn(),
  setGrants: vi.fn(),
  getAccessReport: vi.fn(),
}));
vi.mock("../api/workspaces", () => ({ listAllWorkspaces: vi.fn() }));

const getReport = vi.mocked(accessApi.getAccessReport);
const getCatalog = vi.mocked(accessApi.getAccessCatalog);
const getGrants = vi.mocked(accessApi.getGrants);
const setGrants = vi.mocked(accessApi.setGrants);
const listWorkspaces = vi.mocked(workspacesApi.listAllWorkspaces);

function permissao(overrides: Partial<accessApi.AccessPermission> & Pick<accessApi.AccessPermission, "key" | "label">): accessApi.AccessPermission {
  return {
    description: `Descrição de ${overrides.label}.`,
    scope: "workspace",
    section: "Seção",
    feature: null,
    feature_label: null,
    feature_description: null,
    requires: [],
    ...overrides,
  };
}

const IA = { scope: "global", section: "Inteligência artificial", feature: "ia-gerenciar", feature_label: "Gerenciar a IA", feature_description: "Configurar a IA." } as const;
const ASSINATURAS = { section: "Envios", feature: "assinaturas", feature_label: "Assinaturas por e-mail", feature_description: "Envio recorrente." } as const;

const CATALOG: accessApi.AccessCatalog = {
  permissions: [
    permissao({ key: "colecao.ver", label: "Ver a coleção", description: "Entrar na coleção.", section: "Coleção" }),
    permissao({ key: "relatorio.excluir", label: "Excluir relatório", description: "Remover relatório.", section: "Relatórios", requires: ["colecao.ver"] }),
    permissao({ key: "assinatura.ver", label: "Ver as assinaturas", ...ASSINATURAS, requires: ["colecao.ver"] }),
    permissao({ key: "assinatura.criar", label: "Criar assinaturas", ...ASSINATURAS, requires: ["colecao.ver", "assinatura.ver"] }),
    permissao({ key: "ia.usar", label: "Usar o chat de IA", description: "Conversar com a IA.", scope: "global", section: "Inteligência artificial" }),
    permissao({ key: "ia.chaves", label: "Configurar chaves", ...IA }),
    permissao({ key: "ia.modelos", label: "Escolher modelos", ...IA }),
    permissao({ key: "ia.registro", label: "Ver o registro", ...IA }),
  ],
  presets: { leitor: ["colecao.ver"], editor: ["colecao.ver", "relatorio.excluir"], administrador: ["colecao.ver", "relatorio.excluir"] },
};

const colecao = (id: number, name: string) => ({ id, name, slug: name.toLowerCase() }) as workspacesApi.Workspace;

async function abrir(blocks: accessApi.GrantBlock[], editable = true, kind: "group" | "user" = "group") {
  getCatalog.mockResolvedValue(CATALOG);
  listWorkspaces.mockResolvedValue([colecao(1, "Vendas"), colecao(2, "Financeiro")]);
  getGrants.mockResolvedValue({ blocks, editable });
  render(<AccessEditor kind={kind} id={5} />);
  await screen.findByText("Em todo o sistema");
  expandirTudo();
}

// As seções da lista vêm fechadas; os testes que mexem nos interruptores abrem tudo antes
const expandirTudo = () => fireEvent.click(screen.getByRole("button", { name: "Expandir tudo" }));

beforeEach(() => {
  mocks.showToast.mockClear();
  getCatalog.mockReset();
  getGrants.mockReset();
  setGrants.mockReset();
  listWorkspaces.mockReset();
  getReport.mockReset().mockResolvedValue([]);
});

describe("AccessEditor", () => {
  it("pede as permissões do dono certo e marca só as que ele tem", async () => {
    await abrir([{ workspace_id: null, permissions: ["ia.usar"] }, { workspace_id: 1, permissions: ["colecao.ver"] }], true, "user");

    expect(getGrants).toHaveBeenCalledWith("user", 5);
    expect((screen.getByLabelText(/^Usar o chat de IA/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("region", { name: "Permissões em Vendas" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Permissões em Financeiro" })).toBeNull();
  });

  it("numa pessoa, o que vem de grupo aparece marcado, travado e com o nome do grupo; o resto é livre", async () => {
    getReport.mockResolvedValue([
      {
        user_id: 5,
        name: "Maria",
        email: "maria@demo.com",
        is_admin: false,
        groups: [{ name: "Comercial", is_default: false }],
        workspace_id: 1,
        scope_label: "Vendas",
        permissions: [{ key: "colecao.ver", label: "Ver a coleção", groups: ["Comercial"], direct: false }],
      },
    ]);
    const abrirGrupos = vi.fn();
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([colecao(1, "Vendas")]);
    getGrants.mockResolvedValue({ blocks: [], editable: true });
    render(<AccessEditor kind="user" id={5} onOpenGroups={abrirGrupos} />);

    // A coleção com permissão de grupo aparece sozinha, mesmo sem nada avulso
    const bloco = await screen.findByRole("region", { name: "Permissões em Vendas" });
    expandirTudo();
    const ver = bloco.querySelector("input[id$='-1-colecao.ver']") as HTMLInputElement;
    expect(ver.checked).toBe(true);
    expect(ver.disabled).toBe(true);
    expect(screen.getByText(/Vem do grupo Comercial/)).not.toBeNull();
    expect((bloco.querySelector("input[id$='-1-relatorio.excluir']") as HTMLInputElement).disabled).toBe(false);
    // Não há como remover a coleção (o acesso dela vem do grupo) e, sem nada avulso, não há o que limpar
    expect(screen.queryByRole("button", { name: "Remover coleção" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Limpar avulsas" })).toBeNull();
    // Depois de marcar algo só da pessoa, aparece a opção de limpar só o que é avulso
    fireEvent.click(screen.getByLabelText(/^Excluir relatório/));
    expect(screen.getByRole("button", { name: "Limpar avulsas" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ver no grupo" }));
    expect(abrirGrupos).toHaveBeenCalled();
  });

  it("o atalho Editor não marca de novo o que já vem do grupo", async () => {
    getReport.mockResolvedValue([
      {
        user_id: 5,
        name: "Maria",
        email: "maria@demo.com",
        is_admin: false,
        groups: [],
        workspace_id: 1,
        scope_label: "Vendas",
        permissions: [{ key: "colecao.ver", label: "Ver a coleção", groups: ["Comercial"], direct: false }],
      },
    ]);
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([colecao(1, "Vendas")]);
    getGrants.mockResolvedValue({ blocks: [], editable: true });
    setGrants.mockResolvedValue({ blocks: [{ workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }], editable: true });
    render(<AccessEditor kind="user" id={5} />);
    await screen.findByRole("region", { name: "Permissões em Vendas" });

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));

    // O servidor soma "ver a coleção" sozinho; o rascunho só leva o que é da pessoa
    await waitFor(() => expect(setGrants).toHaveBeenCalledWith("user", 5, [{ workspace_id: 1, permissions: ["relatorio.excluir"] }]));
  });

  it("não mostra a barra de salvar sem mudança", async () => {
    await abrir([]);
    expect(screen.queryByRole("region", { name: "Salvar permissões" })).toBeNull();
  });

  it("adicionar coleção entra só com ver, e o atalho Editor marca o pacote", async () => {
    await abrir([]);

    fireEvent.change(screen.getByLabelText("Coleção para adicionar"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar coleção" }));

    const bloco = screen.getByRole("region", { name: "Permissões em Financeiro" });
    expect((bloco.querySelector("input[id$='-2-colecao.ver']") as HTMLInputElement).checked).toBe(true);
    expect((bloco.querySelector("input[id$='-2-relatorio.excluir']") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect((bloco.querySelector("input[id$='-2-relatorio.excluir']") as HTMLInputElement).checked).toBe(true);
  });

  it("salva só os escopos com permissão e volta a esconder a barra", async () => {
    await abrir([{ workspace_id: 1, permissions: ["colecao.ver"] }]);
    setGrants.mockResolvedValue({
      blocks: [{ workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }],
      editable: true,
    });

    fireEvent.click(screen.getByLabelText(/^Excluir relatório/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));

    await waitFor(() =>
      expect(setGrants).toHaveBeenCalledWith("group", 5, [{ workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }]),
    );
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Permissões salvas."));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Salvar permissões" })).toBeNull());
  });

  it("remover coleção e descartar volta ao que estava salvo", async () => {
    await abrir([{ workspace_id: 1, permissions: ["colecao.ver"] }]);

    fireEvent.click(screen.getByRole("button", { name: "Remover coleção" }));
    expect(screen.queryByRole("region", { name: "Permissões em Vendas" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.getByRole("region", { name: "Permissões em Vendas" })).not.toBeNull();
  });

  it("avisa quando o servidor recusa", async () => {
    await abrir([]);
    setGrants.mockRejectedValue({ response: { data: { detail: "Sem permissão." } } });

    fireEvent.click(screen.getByLabelText(/^Usar o chat de IA/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissão.", "error"));
  });

  it("quem já tem tudo vê as caixas travadas e sem botões de edição", async () => {
    await abrir([], false);

    expect((screen.getByLabelText(/^Usar o chat de IA/) as HTMLInputElement).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Adicionar coleção" })).toBeNull();
    expect(screen.getByText(/já tem todas as permissões/)).not.toBeNull();
  });

  it("mostra erro quando não consegue carregar", async () => {
    getCatalog.mockRejectedValue(new Error("falhou"));
    listWorkspaces.mockResolvedValue([]);
    getGrants.mockRejectedValue(new Error("falhou"));
    render(<AccessEditor kind="group" id={5} />);

    expect(await screen.findByText("Não foi possível carregar as permissões.")).not.toBeNull();
  });
});

describe("AccessEditor - grupos de itens", () => {
  const interruptor = (nome: string) => screen.getByRole("switch", { name: nome }) as HTMLInputElement;
  const clicar = (nome: string) => fireEvent.click(interruptor(nome));
  const ITENS_DA_IA = ["Configurar chaves", "Escolher modelos", "Ver o registro"];
  const salvar = () => fireEvent.click(screen.getByRole("button", { name: "Salvar permissões" }));
  const globais = (chamada: number) => {
    const blocos = setGrants.mock.calls[chamada][2];
    return blocos.find((b) => b.workspace_id === null)?.permissions ?? [];
  };

  it("mostra o grupo com o interruptor dele e os itens embaixo, cada um com o seu, tudo desligado", async () => {
    await abrir([]);

    expect(interruptor("Gerenciar a IA").checked).toBe(false);
    expect(screen.getByText("0 de 3 ligadas")).not.toBeNull();
    for (const nome of ITENS_DA_IA) expect(interruptor(nome).checked).toBe(false);
    // O grupo e os itens ficam juntos; "Usar o chat de IA" é uma permissão sozinha, sem grupo
    expect(interruptor("Gerenciar a IA").closest(".access-feature")?.querySelectorAll(".access-feature-items [role=switch]").length).toBe(3);
    expect(interruptor("Usar o chat de IA").closest(".access-feature")).toBeNull();
  });

  it("ligar o grupo liga todos os itens, e salvar manda os três e mais nada", async () => {
    await abrir([]);
    setGrants.mockResolvedValue({ blocks: [{ workspace_id: null, permissions: ["ia.chaves", "ia.modelos", "ia.registro"] }], editable: true });

    clicar("Gerenciar a IA");

    expect(interruptor("Gerenciar a IA").checked).toBe(true);
    expect(screen.getByText("3 de 3 ligadas")).not.toBeNull();
    for (const nome of ITENS_DA_IA) expect(interruptor(nome).checked).toBe(true);
    expect(interruptor("Usar o chat de IA").checked).toBe(false);

    salvar();
    await waitFor(() => expect(setGrants).toHaveBeenCalled());
    expect(globais(0).sort()).toEqual(["ia.chaves", "ia.modelos", "ia.registro"]);
  });

  it("ligar só um item não liga os outros, e o grupo conta quantos estão ligados", async () => {
    await abrir([]);

    clicar("Escolher modelos");

    expect(interruptor("Escolher modelos").checked).toBe(true);
    expect(interruptor("Configurar chaves").checked).toBe(false);
    expect(interruptor("Gerenciar a IA").checked).toBe(false);
    expect(screen.getByText("1 de 3 ligadas")).not.toBeNull();
  });

  it("desligar um item com o grupo todo ligado deixa o grupo desligado e os outros ligados", async () => {
    await abrir([{ workspace_id: null, permissions: ["ia.chaves", "ia.modelos", "ia.registro"] }]);
    expect(interruptor("Gerenciar a IA").checked).toBe(true);

    clicar("Ver o registro");

    expect(interruptor("Gerenciar a IA").checked).toBe(false);
    expect(interruptor("Configurar chaves").checked).toBe(true);
    expect(interruptor("Escolher modelos").checked).toBe(true);
    expect(screen.getByText("2 de 3 ligadas")).not.toBeNull();
  });

  it("desligar o grupo desliga todos os itens", async () => {
    await abrir([{ workspace_id: null, permissions: ["ia.chaves", "ia.modelos", "ia.registro", "ia.usar"] }]);

    clicar("Gerenciar a IA");

    for (const nome of ITENS_DA_IA) expect(interruptor(nome).checked).toBe(false);
    // O que não é do grupo não muda
    expect(interruptor("Usar o chat de IA").checked).toBe(true);
  });

  it("com o grupo pela metade, ligar o grupo completa o que falta", async () => {
    await abrir([{ workspace_id: null, permissions: ["ia.chaves"] }]);

    clicar("Gerenciar a IA");

    for (const nome of ITENS_DA_IA) expect(interruptor(nome).checked).toBe(true);
  });

  it("criar assinaturas liga ver as assinaturas e a coleção, e desligar ver leva o criar", async () => {
    await abrir([{ workspace_id: 1, permissions: ["colecao.ver"] }]);
    const bloco = () => screen.getByRole("region", { name: "Permissões em Vendas" });
    const daColecao = (nome: string) => within(bloco()).getByRole("switch", { name: nome }) as HTMLInputElement;

    fireEvent.click(daColecao("Criar assinaturas"));
    expect(daColecao("Criar assinaturas").checked).toBe(true);
    expect(daColecao("Ver as assinaturas").checked).toBe(true);
    expect(daColecao("Assinaturas por e-mail").checked).toBe(true);

    fireEvent.click(daColecao("Ver as assinaturas"));
    expect(daColecao("Criar assinaturas").checked).toBe(false);
    expect(daColecao("Ver as assinaturas").checked).toBe(false);
    // Ver a coleção continua, porque ela não depende das assinaturas
    expect(daColecao("Ver a coleção").checked).toBe(true);
  });

  it("cada coleção tem os seus grupos de itens, ligados de forma independente", async () => {
    await abrir([
      { workspace_id: 1, permissions: ["colecao.ver"] },
      { workspace_id: 2, permissions: ["colecao.ver"] },
    ]);
    const mestreDe = (colecao: string) =>
      within(screen.getByRole("region", { name: `Permissões em ${colecao}` })).getByRole("switch", { name: "Assinaturas por e-mail" }) as HTMLInputElement;

    fireEvent.click(mestreDe("Vendas"));

    expect(mestreDe("Vendas").checked).toBe(true);
    expect(mestreDe("Financeiro").checked).toBe(false);
  });

  it("numa pessoa, o item que vem de grupo fica ligado e travado, e o grupo liga só o resto", async () => {
    getReport.mockResolvedValue([
      {
        user_id: 5,
        name: "Maria",
        email: "maria@demo.com",
        is_admin: false,
        groups: [{ name: "Dados", is_default: false }],
        workspace_id: null,
        scope_label: "Em todo o sistema",
        permissions: [{ key: "ia.chaves", label: "Configurar chaves", groups: ["Dados"], direct: false }],
      },
    ]);
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([colecao(1, "Vendas")]);
    getGrants.mockResolvedValue({ blocks: [], editable: true });
    setGrants.mockResolvedValue({ blocks: [{ workspace_id: null, permissions: ["ia.modelos", "ia.registro"] }], editable: true });
    render(<AccessEditor kind="user" id={5} />);
    await screen.findByText("Em todo o sistema");
    expandirTudo();

    expect(interruptor("Configurar chaves").checked).toBe(true);
    expect(interruptor("Configurar chaves").disabled).toBe(true);
    expect(screen.getByText("1 de 3 ligadas")).not.toBeNull();

    clicar("Gerenciar a IA");

    expect(interruptor("Gerenciar a IA").checked).toBe(true);
    salvar();
    // O que já vem do grupo não vai para as permissões avulsas da pessoa
    await waitFor(() => expect(setGrants).toHaveBeenCalled());
    expect(globais(0).sort()).toEqual(["ia.modelos", "ia.registro"]);

    // Com o grupo ligado, desligar tira só o que era avulso; a chave de grupo continua ligada e travada
    clicar("Gerenciar a IA");
    expect(interruptor("Configurar chaves").checked).toBe(true);
    expect(interruptor("Escolher modelos").checked).toBe(false);
  });

  it("se todos os itens vêm de grupo, o interruptor do grupo fica travado", async () => {
    getReport.mockResolvedValue([
      {
        user_id: 5,
        name: "Maria",
        email: "maria@demo.com",
        is_admin: false,
        groups: [{ name: "Dados", is_default: false }],
        workspace_id: null,
        scope_label: "Em todo o sistema",
        permissions: ["ia.chaves", "ia.modelos", "ia.registro"].map((key) => ({ key, label: key, groups: ["Dados"], direct: false })),
      },
    ]);
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([]);
    getGrants.mockResolvedValue({ blocks: [], editable: true });
    render(<AccessEditor kind="user" id={5} />);
    await screen.findByText("Em todo o sistema");
    expandirTudo();

    expect(interruptor("Gerenciar a IA").checked).toBe(true);
    expect(interruptor("Gerenciar a IA").disabled).toBe(true);
  });
});

describe("AccessEditor - pesquisa e seções que abrem e fecham", () => {
  // Sem usar o helper abrir, que já abre tudo
  async function abrirFechado(blocks: accessApi.GrantBlock[] = []) {
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([colecao(1, "Vendas")]);
    getGrants.mockResolvedValue({ blocks, editable: true });
    render(<AccessEditor kind="group" id={5} />);
    await screen.findByText("Em todo o sistema");
  }
  const cabecalho = (nome: string | RegExp) => screen.getAllByRole("button", { name: nome })[0];
  const escopoGlobal = () => screen.getByRole("region", { name: "Permissões do sistema todo" });

  it("as seções vêm fechadas e o título diz quantas permissões estão ligadas", async () => {
    await abrirFechado([{ workspace_id: null, permissions: ["ia.chaves", "ia.usar"] }]);

    const ia = within(escopoGlobal()).getByRole("button", { name: /Inteligência artificial/ });
    expect(ia.getAttribute("aria-expanded")).toBe("false");
    expect(ia.textContent).toContain("2 de 4 ligadas");
    // Fechada, a seção não mostra os interruptores
    expect(within(escopoGlobal()).queryByRole("switch", { name: "Usar o chat de IA" })).toBeNull();
  });

  it("clicar no título abre e fecha a seção, sem perder o que foi ligado", async () => {
    await abrirFechado();
    const ia = () => within(escopoGlobal()).getByRole("button", { name: /Inteligência artificial/ });

    fireEvent.click(ia());
    expect(ia().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Usar o chat de IA" }));

    fireEvent.click(ia());
    expect(ia().getAttribute("aria-expanded")).toBe("false");
    expect(ia().textContent).toContain("1 de 4 ligadas");

    fireEvent.click(ia());
    expect((screen.getByRole("switch", { name: "Usar o chat de IA" }) as HTMLInputElement).checked).toBe(true);
  });

  it("Expandir tudo abre todas as seções e Recolher tudo fecha de novo", async () => {
    await abrirFechado([{ workspace_id: 1, permissions: ["colecao.ver"] }]);

    fireEvent.click(screen.getByRole("button", { name: "Expandir tudo" }));
    expect(screen.getByRole("switch", { name: "Usar o chat de IA" })).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Permissões em Vendas" })).getByRole("switch", { name: "Ver a coleção" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Recolher tudo" }));
    expect(screen.queryByRole("switch", { name: "Usar o chat de IA" })).toBeNull();
    expect(cabecalho(/Inteligência artificial/).getAttribute("aria-expanded")).toBe("false");
  });

  it("a pesquisa abre só o que combina, sem ligar nem desligar nada, e ignora acentos e maiúsculas", async () => {
    await abrirFechado([{ workspace_id: 1, permissions: ["colecao.ver"] }]);

    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "REGISTRO" } });

    expect(screen.getByRole("switch", { name: "Ver o registro" })).not.toBeNull();
    // O resto da seção não combina e fica de fora; o grupo mostra o mestre com os itens que combinam
    expect(screen.queryByRole("switch", { name: "Usar o chat de IA" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Escolher modelos" })).toBeNull();
    expect(screen.queryByText("Coleção", { selector: ".access-section-title" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "colecao" } });
    expect(screen.getByRole("switch", { name: "Ver a coleção" })).not.toBeNull();
  });

  it("pesquisar pelo nome do grupo de itens mostra todos os itens dele", async () => {
    await abrirFechado();

    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "gerenciar a ia" } });

    for (const nome of ["Configurar chaves", "Escolher modelos", "Ver o registro"]) {
      expect(screen.getByRole("switch", { name: nome })).not.toBeNull();
    }
  });

  it("ligar o mestre durante a pesquisa liga todos os itens do grupo, não só os que aparecem", async () => {
    await abrirFechado();
    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "registro" } });

    fireEvent.click(screen.getByRole("switch", { name: "Gerenciar a IA" }));
    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Expandir tudo" }));

    for (const nome of ["Configurar chaves", "Escolher modelos", "Ver o registro"]) {
      expect((screen.getByRole("switch", { name: nome }) as HTMLInputElement).checked).toBe(true);
    }
  });

  it("sem resultado, avisa e não mostra as listas", async () => {
    await abrirFechado();

    fireEvent.change(screen.getByLabelText("Pesquisar permissões"), { target: { value: "zzzz" } });

    expect(screen.getByText(/Nenhuma permissão encontrada para/)).not.toBeNull();
    expect(screen.queryByText("Em todo o sistema")).toBeNull();
    expect(screen.queryByText("Por coleção")).toBeNull();
  });
});

describe("AccessEditor - so se da e se tira o que se tem", () => {
  async function abrirComRestricao(blocks: accessApi.GrantBlock[], allowed: (scope: string, key: string) => boolean) {
    getCatalog.mockResolvedValue(CATALOG);
    listWorkspaces.mockResolvedValue([colecao(1, "Vendas"), colecao(2, "Financeiro")]);
    getGrants.mockResolvedValue({ blocks, editable: true });
    render(<AccessEditor kind="user" id={5} allowed={allowed} />);
    await screen.findByText("Em todo o sistema");
    expandirTudo();
  }
  const interruptor = (nome: string) => screen.getByRole("switch", { name: nome }) as HTMLInputElement;

  it("a permissao que a pessoa nao tem fica travada, com aviso, e as outras continuam livres", async () => {
    await abrirComRestricao([], (_escopo, chave) => chave !== "ia.usar");

    expect(interruptor("Usar o chat de IA").disabled).toBe(true);
    expect(screen.getByText(/Você não tem esta permissão, então não pode dá-la nem tirá-la/)).toBeTruthy();
    expect(interruptor("Configurar chaves").disabled).toBe(false);
  });

  it("travada vale para ligar e para desligar: o que ja estava marcado nao sai", async () => {
    await abrirComRestricao([{ workspace_id: null, permissions: ["ia.usar"] }], (_escopo, chave) => chave !== "ia.usar");

    expect(interruptor("Usar o chat de IA").checked).toBe(true);
    expect(interruptor("Usar o chat de IA").disabled).toBe(true);
  });

  it("o interruptor do grupo de itens mexe so no que a pessoa tem", async () => {
    await abrirComRestricao([], (_escopo, chave) => chave !== "ia.modelos");

    fireEvent.click(interruptor("Gerenciar a IA"));

    expect(interruptor("Configurar chaves").checked).toBe(true);
    expect(interruptor("Ver o registro").checked).toBe(true);
    expect(interruptor("Escolher modelos").checked).toBe(false);
  });

  it("se a pessoa nao tem nenhum item do grupo, o interruptor do grupo fica travado", async () => {
    await abrirComRestricao([], (_escopo, chave) => !chave.startsWith("ia."));

    expect(interruptor("Gerenciar a IA").disabled).toBe(true);
  });

  it("o atalho da coleção so liga o que a pessoa tem", async () => {
    const tem = (escopo: string, chave: string) => !(escopo === "1" && chave === "relatorio.excluir");
    await abrirComRestricao([{ workspace_id: 1, permissions: ["colecao.ver"] }], tem);

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));

    const vendas = within(screen.getByRole("region", { name: "Permissões em Vendas" }));
    expect((vendas.getByRole("switch", { name: "Ver a coleção" }) as HTMLInputElement).checked).toBe(true);
    expect((vendas.getByRole("switch", { name: "Excluir relatório" }) as HTMLInputElement).checked).toBe(false);
  });

  it("so se pode liberar uma coleção que a pessoa enxerga", async () => {
    await abrirComRestricao([], (escopo) => escopo !== "2");

    const opcoes = Array.from((screen.getByLabelText("Coleção para adicionar") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opcoes).toContain("Vendas");
    expect(opcoes).not.toContain("Financeiro");
  });

  it("nao da para remover a coleção quando ha nela permissao que a pessoa nao tem", async () => {
    await abrirComRestricao(
      [{ workspace_id: 1, permissions: ["colecao.ver", "relatorio.excluir"] }],
      (_escopo, chave) => chave !== "relatorio.excluir",
    );

    expect((screen.getByRole("button", { name: "Remover coleção" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem a restricao tudo continua livre, como antes", async () => {
    await abrirComRestricao([], () => true);

    expect(interruptor("Usar o chat de IA").disabled).toBe(false);
    expect(screen.queryByText(/Você não tem esta permissão/)).toBeNull();
  });
});
