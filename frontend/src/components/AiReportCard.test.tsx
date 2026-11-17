import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aiReportApi from "../api/aiReport";
import type { AIReportSchema, AIReportSettings } from "../api/aiReport";
import * as reportsApi from "../api/reports";
import AiReportCard from "./AiReportCard";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../context/WorkspaceContext", () => {
  const workspaces = [{ id: 1, name: "Comercial" }, { id: 2, name: "Saude" }];
  return { useWorkspace: () => ({ workspaces }) };
});
vi.mock("../api/reports", () => ({ listReports: vi.fn() }));
vi.mock("../api/aiReport", () => ({
  getReportSchema: vi.fn(),
  getReportSettings: vi.fn(),
  saveReportSettings: vi.fn(),
  getReviewStates: vi.fn(),
  markReportReviewed: vi.fn(),
}));

const listReports = vi.mocked(reportsApi.listReports);
const getSchema = vi.mocked(aiReportApi.getReportSchema);
const getSettings = vi.mocked(aiReportApi.getReportSettings);
const saveSettings = vi.mocked(aiReportApi.saveReportSettings);
const getReviews = vi.mocked(aiReportApi.getReviewStates);
const markReviewed = vi.mocked(aiReportApi.markReportReviewed);

const ESQUEMA: AIReportSchema = {
  report_id: 5,
  report_name: "Carteira",
  eligible: true,
  reason: null,
  tables: [
    {
      name: "fato_carteira",
      columns: [
        { name: "unidade", data_type: "texto", distinct: 1377, blocked: false },
        { name: "vidas", data_type: "inteiro", distinct: null, blocked: false },
      ],
      measures: ["Vidas Ativas"],
      in_prompt: true,
    },
    { name: "dim_unidade", columns: [{ name: "uf", data_type: "texto", distinct: 5, blocked: false }], measures: [], in_prompt: true },
  ],
  prompt_chars: 2500,
  prompt_max_chars: 12000,
  omitted_tables: [],
  omitted_columns: 0,
  hidden_columns: 0,
};

const CONFIG: AIReportSettings = {
  report_id: 5,
  report_name: "Carteira",
  notes: "",
  blocked_columns: [],
  allow_images: false,
  review: "reviewed",
};

const seletor = () => screen.getByLabelText("Relatorio") as HTMLSelectElement;

async function abrirRelatorio(schema = ESQUEMA, settings = CONFIG) {
  getSchema.mockResolvedValue(schema);
  getSettings.mockResolvedValue(settings);
  render(<AiReportCard />);
  await waitFor(() => expect(seletor().options.length).toBeGreaterThan(1));
  fireEvent.change(seletor(), { target: { value: "5" } });
  await screen.findByText(/A IA recebe/);
}

beforeEach(() => {
  mocks.showToast.mockClear();
  listReports.mockReset();
  getSchema.mockReset();
  getSettings.mockReset();
  saveSettings.mockReset();
  getReviews.mockReset();
  getReviews.mockResolvedValue([]);
  markReviewed.mockReset();
  listReports.mockImplementation(async (colecao: number) =>
    colecao === 1
      ? ([{ id: 5, name: "Carteira" }, { id: 6, name: "Vendas" }] as never)
      : ([{ id: 9, name: "Custo Assistencial" }] as never),
  );
});

describe("AiReportCard - escolher o relatorio", () => {
  it("lista os relatorios de todas as colecoes com o nome da colecao", async () => {
    render(<AiReportCard />);

    await waitFor(() => expect(seletor().options.length).toBe(4));
    expect(Array.from(seletor().options).map((o) => o.text)).toEqual([
      "Escolha um relatorio",
      "Carteira (Comercial)",
      "Vendas (Comercial)",
      "Custo Assistencial (Saude)",
    ]);
  });

  it("uma colecao que falha nao esconde as outras", async () => {
    listReports.mockImplementation(async (colecao: number) => {
      if (colecao === 1) throw new Error("403");
      return [{ id: 9, name: "Custo Assistencial" }] as never;
    });
    render(<AiReportCard />);

    await waitFor(() => expect(seletor().options.length).toBe(2));
  });

  it("escolher um relatorio le o esquema e as configuracoes", async () => {
    await abrirRelatorio();

    expect(getSchema).toHaveBeenCalledWith(5, false);
    expect(getSettings).toHaveBeenCalledWith(5);
    expect(screen.getByText(/A IA recebe 2 de 2 tabelas \(2.500 de 12.000 caracteres\)/)).toBeTruthy();
  });

  it("mostra o motivo quando o chat nao consulta o relatorio (RLS)", async () => {
    const bloqueado: AIReportSchema = { ...ESQUEMA, eligible: false, reason: "Este relatorio usa seguranca por linha (RLS).", tables: null };
    getSchema.mockResolvedValue(bloqueado);
    getSettings.mockResolvedValue(CONFIG);
    render(<AiReportCard />);
    await waitFor(() => expect(seletor().options.length).toBeGreaterThan(1));

    fireEvent.change(seletor(), { target: { value: "5" } });

    expect(await screen.findByText(/O chat nao consulta este relatorio. Este relatorio usa seguranca por linha/)).toBeTruthy();
    expect(screen.queryByText("Salvar")).toBeNull();
  });

  it("falha ao ler mostra o aviso e nao mostra o formulario", async () => {
    getSchema.mockRejectedValue({ response: { data: { detail: "O Power BI nao respondeu" } } });
    getSettings.mockResolvedValue(CONFIG);
    render(<AiReportCard />);
    await waitFor(() => expect(seletor().options.length).toBeGreaterThan(1));

    fireEvent.change(seletor(), { target: { value: "5" } });

    expect(await screen.findByText("O Power BI nao respondeu")).toBeTruthy();
    expect(screen.queryByText("Salvar")).toBeNull();
  });

  it("voltar para 'Escolha um relatorio' limpa a tela", async () => {
    await abrirRelatorio();

    fireEvent.change(seletor(), { target: { value: "" } });

    expect(screen.queryByText(/A IA recebe/)).toBeNull();
  });
});

describe("AiReportCard - o que a IA enxerga", () => {
  it("mostra colunas com tipo e quantidade de valores, e as medidas", async () => {
    await abrirRelatorio();

    const bloco = screen.getByText(/fato_carteira \(2 colunas, 1 medidas\)/).closest("details")!;
    expect(within(bloco).getByText("1.377")).toBeTruthy();
    expect(within(bloco).getByText("Medidas: Vidas Ativas")).toBeTruthy();
    expect(within(bloco).getAllByText("-").length).toBeGreaterThan(0); // coluna sem contagem
  });

  it("avisa as tabelas que ficaram de fora por tamanho e marca a tabela", async () => {
    const cortado: AIReportSchema = {
      ...ESQUEMA,
      tables: [ESQUEMA.tables![0], { ...ESQUEMA.tables![1], in_prompt: false }],
      omitted_tables: ["dim_unidade"],
      omitted_columns: 4,
      hidden_columns: 3,
    };
    await abrirRelatorio(cortado);

    expect(screen.getByText(/Ficaram de fora por tamanho e a IA nao consegue usar: dim_unidade/)).toBeTruthy();
    expect(screen.getByText(/A IA recebe 1 de 2 tabelas/)).toBeTruthy();
    expect(screen.getByText("fora do esquema da IA")).toBeTruthy();
    expect(screen.getByText("4 colunas foram cortadas pelo limite por tabela.")).toBeTruthy();
    expect(screen.getByText("3 colunas ocultas no modelo nao sao vistas pela IA.")).toBeTruthy();
  });

  it("Atualizar do Power BI le o esquema de novo, sem o cache", async () => {
    await abrirRelatorio();

    fireEvent.click(screen.getByText("Atualizar do Power BI"));

    await waitFor(() => expect(getSchema).toHaveBeenLastCalledWith(5, true));
  });
});

describe("AiReportCard - salvar", () => {
  it("comeca com o Salvar desligado e liga ao mudar qualquer coisa", async () => {
    await abrirRelatorio();
    const salvar = screen.getByText("Salvar") as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Orientacoes para a IA/), { target: { value: "unidade e o estado" } });

    expect(salvar.disabled).toBe(false);
  });

  it("bloquear uma coluna e salvar manda a lista, as orientacoes e a imagem", async () => {
    await abrirRelatorio();
    saveSettings.mockResolvedValue({
      ...CONFIG,
      notes: "unidade e o estado",
      blocked_columns: [{ table: "fato_carteira", column: "unidade" }],
      allow_images: true,
    });

    fireEvent.click(screen.getByLabelText("Bloquear fato_carteira[unidade]"));
    fireEvent.change(screen.getByLabelText(/Orientacoes para a IA/), { target: { value: "  unidade e o estado  " } });
    fireEvent.click(screen.getByLabelText(/Permitir que a IA veja a imagem/));
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(5, {
        notes: "unidade e o estado",
        blocked_columns: [{ table: "fato_carteira", column: "unidade" }],
        allow_images: true,
      }),
    );
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Configuracao do relatorio salva."));
    expect((screen.getByText("Salvar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("depois de salvar, le o esquema de novo para a contagem refletir os bloqueios", async () => {
    await abrirRelatorio();
    saveSettings.mockResolvedValue({ ...CONFIG, allow_images: true });

    fireEvent.click(screen.getByLabelText(/Permitir que a IA veja a imagem/));
    getSchema.mockClear();
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() => expect(getSchema).toHaveBeenCalledWith(5));
  });

  it("desmarcar uma coluna ja bloqueada tira ela da lista", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, blocked_columns: [{ table: "fato_carteira", column: "unidade" }] });
    saveSettings.mockResolvedValue(CONFIG);
    const caixa = screen.getByLabelText("Bloquear fato_carteira[unidade]") as HTMLInputElement;
    expect(caixa.checked).toBe(true);

    fireEvent.click(caixa);
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(5, { notes: "", blocked_columns: [], allow_images: false }));
  });

  it("o bloqueio guardado de uma coluna que sumiu do modelo nao se perde ao salvar", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, blocked_columns: [{ table: "tabela_antiga", column: "cpf" }] });
    saveSettings.mockResolvedValue(CONFIG);

    fireEvent.change(screen.getByLabelText(/Orientacoes para a IA/), { target: { value: "oi" } });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(5, {
        notes: "oi",
        blocked_columns: [{ table: "tabela_antiga", column: "cpf" }],
        allow_images: false,
      }),
    );
  });

  it("falha ao salvar mostra o aviso e deixa a tela como esta", async () => {
    await abrirRelatorio();
    saveSettings.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });

    fireEvent.click(screen.getByLabelText("Bloquear dim_unidade[uf]"));
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissao", "error"));
    expect((screen.getByLabelText("Bloquear dim_unidade[uf]") as HTMLInputElement).checked).toBe(true);
  });

  it("explica que a imagem vai ao provedor e que fica desligada ate o admin ligar", async () => {
    await abrirRelatorio();

    expect(screen.getByText(/e enviada ao provedor de IA/)).toBeTruthy();
    expect((screen.getByLabelText(/Permitir que a IA veja a imagem/) as HTMLInputElement).checked).toBe(false);
  });
});

describe("AiReportCard - revisao das colunas", () => {
  it("marca na lista os relatorios que ainda nao foram revisados e conta quantos faltam", async () => {
    getReviews.mockResolvedValue([
      { report_id: 5, review: "unreviewed" },
      { report_id: 6, review: "reviewed" },
      { report_id: 9, review: "pending" },
    ]);
    render(<AiReportCard />);

    await waitFor(() => expect(seletor().options.length).toBe(4));
    await waitFor(() =>
      expect(Array.from(seletor().options).map((o) => o.text)).toEqual([
        "Escolha um relatorio",
        "Carteira (Comercial) - nao revisado",
        "Vendas (Comercial)",
        "Custo Assistencial (Saude) - fechado ate revisar",
      ]),
    );
    expect(screen.getByText("2 de 3 relatorios ainda sem revisao das colunas.")).toBeTruthy();
  });

  it("sem nenhum relatorio pendente nao mostra a contagem", async () => {
    render(<AiReportCard />);

    await waitFor(() => expect(seletor().options.length).toBe(4));
    expect(screen.queryByText(/ainda sem revisao das colunas/)).toBeNull();
  });

  it("se o estado de revisao nao carregar, a lista aparece igual, sem marcas", async () => {
    getReviews.mockRejectedValue(new Error("falhou"));
    render(<AiReportCard />);

    await waitFor(() => expect(seletor().options.length).toBe(4));
    expect(Array.from(seletor().options).map((o) => o.text)[1]).toBe("Carteira (Comercial)");
  });

  it("relatorio novo mostra que o chat ainda nao o consulta e oferece marcar como revisado", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "pending" });

    expect(screen.getByText(/Relatorio novo: o chat ainda nao o consulta/)).toBeTruthy();
    expect((screen.getByText("Marcar como revisado") as HTMLButtonElement).disabled).toBe(false);
  });

  it("relatorio de antes avisa que o chat ja o consulta e pede para conferir as colunas", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "unreviewed" });

    expect(screen.getByText(/ainda nao foram revisadas\. O chat ja o consulta/)).toBeTruthy();
    expect(screen.getByText("Marcar como revisado")).toBeTruthy();
  });

  it("relatorio revisado nao mostra o botao", async () => {
    await abrirRelatorio();

    expect(screen.getByText("Colunas revisadas: o chat consulta este relatorio.")).toBeTruthy();
    expect(screen.queryByText("Marcar como revisado")).toBeNull();
  });

  it("marcar como revisado funciona sem bloquear nenhuma coluna e libera o aviso", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "pending" });
    markReviewed.mockResolvedValue({ ...CONFIG, review: "reviewed" });

    fireEvent.click(screen.getByText("Marcar como revisado"));

    await waitFor(() => expect(markReviewed).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByText("Marcar como revisado")).toBeNull());
    expect(screen.getByText("Colunas revisadas: o chat consulta este relatorio.")).toBeTruthy();
    expect(mocks.showToast).toHaveBeenCalledWith("Colunas revisadas. O chat ja pode consultar este relatorio.");
  });

  it("com mudancas nao salvas o botao fica desligado e pede para salvar antes", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "pending" });

    fireEvent.click(screen.getByLabelText("Bloquear dim_unidade[uf]"));

    expect((screen.getByText("Marcar como revisado") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Salve as mudancas antes de marcar como revisado/)).toBeTruthy();
  });

  it("falha ao marcar mostra o aviso e mantem o relatorio como esta", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "pending" });
    markReviewed.mockRejectedValue({ response: { data: { detail: "Sem permissao" } } });

    fireEvent.click(screen.getByText("Marcar como revisado"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Sem permissao", "error"));
    expect(screen.getByText(/Relatorio novo: o chat ainda nao o consulta/)).toBeTruthy();
  });

  it("salvar um relatorio novo nao o libera: o aviso continua ate marcar como revisado", async () => {
    await abrirRelatorio(ESQUEMA, { ...CONFIG, review: "pending" });
    saveSettings.mockResolvedValue({ ...CONFIG, review: "pending", notes: "oi" });

    fireEvent.change(screen.getByLabelText(/Orientacoes para a IA/), { target: { value: "oi" } });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByText("Salvar") as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Relatorio novo: o chat ainda nao o consulta/)).toBeTruthy();
  });
});

const ESQUEMA_COM_SUGESTOES: AIReportSchema = {
  ...ESQUEMA,
  tables: [
    {
      name: "fato_carteira",
      columns: [
        { name: "unidade", data_type: "texto", distinct: 1377, blocked: false, suggestion: "many_values" },
        { name: "vidas", data_type: "inteiro", distinct: null, blocked: false, suggestion: null },
      ],
      measures: [],
      in_prompt: true,
    },
    {
      name: "dim_pessoa",
      columns: [
        { name: "nome_beneficiario", data_type: "texto", distinct: 40, blocked: false, suggestion: "name" },
        { name: "uf", data_type: "texto", distinct: 5, blocked: false, suggestion: null },
      ],
      measures: [],
      in_prompt: true,
    },
  ],
};

describe("AiReportCard - sugestao de colunas para bloquear", () => {
  it("avisa quantas colunas parecem ter dados de pessoas e marca a tabela onde elas estao", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);

    expect(screen.getByText(/2 colunas parecem ter dados de pessoas ou documentos\./)).toBeTruthy();
    expect(screen.getAllByText(/com colunas sugeridas para bloqueio/)).toHaveLength(2);
  });

  it("diz o motivo de cada coluna sugerida e nao marca as outras", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);

    expect(screen.getByText("Texto com 1.377 valores diferentes, parece nomes ou codigos")).toBeTruthy();
    expect(screen.getByText("O nome parece dado de pessoa ou documento")).toBeTruthy();
    expect(screen.getAllByText(/parece nomes ou codigos|parece dado de pessoa/)).toHaveLength(2);
  });

  it("so sinaliza: nenhuma coluna vem marcada para bloqueio e o Salvar segue desligado", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);

    expect((screen.getByLabelText("Bloquear fato_carteira[unidade]") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Bloquear dim_pessoa[nome_beneficiario]") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByText("Salvar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Marcar as sugeridas marca so as sugeridas, liga o Salvar e nao grava nada sozinho", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);

    fireEvent.click(screen.getByText("Marcar as sugeridas para bloqueio"));

    expect((screen.getByLabelText("Bloquear fato_carteira[unidade]") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Bloquear dim_pessoa[nome_beneficiario]") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Bloquear fato_carteira[vidas]") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Bloquear dim_pessoa[uf]") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByText("Salvar") as HTMLButtonElement).disabled).toBe(false);
    expect(saveSettings).not.toHaveBeenCalled();
    // Ja marcadas: o aviso e as sugestoes somem
    expect(screen.queryByText(/parecem ter dados de pessoas/)).toBeNull();
    expect(screen.queryByText("Marcar as sugeridas para bloqueio")).toBeNull();
  });

  it("salvar depois de marcar as sugeridas manda essas colunas na lista", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);
    saveSettings.mockResolvedValue(CONFIG);

    fireEvent.click(screen.getByText("Marcar as sugeridas para bloqueio"));
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(5, {
        notes: "",
        blocked_columns: [
          { table: "fato_carteira", column: "unidade" },
          { table: "dim_pessoa", column: "nome_beneficiario" },
        ],
        allow_images: false,
      }),
    );
  });

  it("coluna sugerida que ja estava bloqueada nao entra na contagem e nao duplica na lista", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES, {
      ...CONFIG,
      blocked_columns: [{ table: "fato_carteira", column: "unidade" }],
    });
    saveSettings.mockResolvedValue(CONFIG);

    expect(screen.getByText(/1 coluna parece ter dados de pessoas ou documentos\./)).toBeTruthy();
    fireEvent.click(screen.getByText("Marcar as sugeridas para bloqueio"));
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(5, {
        notes: "",
        blocked_columns: [
          { table: "fato_carteira", column: "unidade" },
          { table: "dim_pessoa", column: "nome_beneficiario" },
        ],
        allow_images: false,
      }),
    );
  });

  it("o admin pode desmarcar uma sugerida depois de usar o botao", async () => {
    await abrirRelatorio(ESQUEMA_COM_SUGESTOES);

    fireEvent.click(screen.getByText("Marcar as sugeridas para bloqueio"));
    fireEvent.click(screen.getByLabelText("Bloquear fato_carteira[unidade]"));

    expect((screen.getByLabelText("Bloquear fato_carteira[unidade]") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Bloquear dim_pessoa[nome_beneficiario]") as HTMLInputElement).checked).toBe(true);
  });

  it("sem nenhuma sugestao nao mostra aviso nem botao", async () => {
    await abrirRelatorio();

    expect(screen.queryByText(/parecem ter dados de pessoas|parece ter dados de pessoas/)).toBeNull();
    expect(screen.queryByText("Marcar as sugeridas para bloqueio")).toBeNull();
  });
});
