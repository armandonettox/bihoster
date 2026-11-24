import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import * as reportsApi from "../api/reports";
import ChatPanel from "../components/ChatPanel";
import ChatPanelToggle from "../components/ChatPanelToggle";
import { AccessContext, buildAccess } from "../context/AccessContext";
import { ChatProvider } from "../context/ChatContext";
import { deferred, makeReport } from "../test-fixtures";
import ReportFullscreen from "./ReportFullscreen";

const mocks = vi.hoisted(() => ({
  selectWorkspace: vi.fn(),
  access: { canSubscribe: false, allowedDomains: [] as string[] },
  canUseChat: true,
  // Permissoes de quem esta vendo o relatorio (colecao 3)
  permissoes: [] as string[],
}));

vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../hooks/useAiAccess", () => ({
  useAiAccess: () => ({ canManage: false, canUse: mocks.canUseChat, loading: false }),
}));
vi.mock("../api/aiChat", () => ({
  sendChatMessage: vi.fn(),
  listConversations: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  deleteAllConversations: vi.fn(),
}));
vi.mock("../api/reports", () => ({ getReport: vi.fn() }));
vi.mock("../context/WorkspaceContext", () => ({
  useWorkspace: () => ({ selectWorkspace: mocks.selectWorkspace, workspaces: [{ id: 3, role: "editor" }] }),
}));
vi.mock("../hooks/useSubscriptionAccess", () => ({ useSubscriptionAccess: () => mocks.access }));
vi.mock("../components/ReportSubscriptionsModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog">
      janela de assinaturas<button onClick={onClose}>fechar janela</button>
    </div>
  ),
}));
// A janela de exportar tem teste proprio: aqui so importa se aparece e se a pessoa pode gerar PDF e imagem
vi.mock("../components/ExportMenu", () => ({
  default: ({ canExportFile }: { canExportFile: boolean }) => (
    <button type="button">{canExportFile ? "Exportar (com arquivo)" : "Exportar (so tabelas)"}</button>
  ),
}));
vi.mock("../context/BrandingContext", () => ({ useBranding: () => ({ settings: null }) }));
vi.mock("../components/ReportEmbed", () => ({
  default: ({ reportId, workspaceId }: { reportId: number; workspaceId: number }) => (
    <div data-testid="embed">{`relatorio ${reportId} da colecao ${workspaceId}`}</div>
  ),
}));

const getReport = vi.mocked(reportsApi.getReport);
const RELATORIO = makeReport(34, { name: "Vendas e Inclusoes", collection_id: 3 });

/** `historico` e a pilha de enderecos; `indice` qual deles esta aberto (por padrao o ultimo) */
function abrir(historico: string[], indice = historico.length - 1) {
  const me: MyAccess = { is_admin: false, global_permissions: [], workspace_permissions: { "3": mocks.permissoes } };
  return render(
    <AccessContext.Provider value={buildAccess(me)}>
    <MemoryRouter initialEntries={historico} initialIndex={indice}>
      <ChatProvider>
        <Routes>
          <Route
            path="/collection"
            element={
              <div>
                pagina da colecao
                <ChatPanelToggle />
                <ChatPanel />
                <Link to="/collection/3/report/34">abrir relatorio</Link>
              </div>
            }
          />
          <Route path="/collection/:workspaceId/report/:reportId" element={<ReportFullscreen />} />
        </Routes>
      </ChatProvider>
    </MemoryRouter>
    </AccessContext.Provider>,
  );
}

beforeEach(() => {
  mocks.canUseChat = true;
  mocks.permissoes = ["colecao.ver"];
  document.title = "BIHoster";
  mocks.selectWorkspace.mockReset();
  mocks.access = { canSubscribe: false, allowedDomains: [] };
  getReport.mockResolvedValue(RELATORIO);
});

describe("ReportFullscreen - abrir", () => {
  it("busca o relatorio pelo endereco e o abre na colecao certa", async () => {
    abrir(["/collection/3/report/34"]);

    expect((await screen.findByTestId("embed")).textContent).toBe("relatorio 34 da colecao 3");
    expect(getReport).toHaveBeenCalledWith(3, 34);
  });

  it("mostra o carregando enquanto o relatorio nao chega", async () => {
    const resposta = deferred<typeof RELATORIO>();
    getReport.mockReturnValue(resposta.promise);
    abrir(["/collection/3/report/34"]);

    expect(screen.getByText("Carregando relatorio...")).toBeTruthy();

    resposta.resolve(RELATORIO);
    expect(await screen.findByTestId("embed")).toBeTruthy();
  });

  it("o cabecalho tem so a logo: o nome do relatorio vai para a dica e para o titulo da aba", async () => {
    const { container, unmount } = abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    expect(screen.queryByText("Vendas e Inclusoes")).toBeNull();
    // O titulo da aba e posto por um efeito, depois de o relatorio carregar: espera em vez de conferir na hora, senao o
    // teste falha de vez em quando quando a maquina esta carregada
    await waitFor(() => expect(document.title).toBe("Vendas e Inclusoes - BIHoster"));
    expect(container.querySelector(".fullscreen-header-brand")?.getAttribute("title")).toBe("Vendas e Inclusoes");

    unmount();
    expect(document.title).toBe("BIHoster");
  });

  it("mostra o motivo quando nao ha acesso, sem abrir nada", async () => {
    getReport.mockRejectedValue({ response: { data: { detail: "Voce nao tem acesso a esta colecao" } } });
    abrir(["/collection/3/report/34"]);

    expect(await screen.findByText("Voce nao tem acesso a esta colecao")).toBeTruthy();
    expect(screen.queryByTestId("embed")).toBeNull();
  });

  it("avisa quando o endereco nao tem numeros validos, sem chamar a API", () => {
    abrir(["/collection/abc/report/xyz"]);

    expect(screen.getByText("Endereco do relatorio invalido.")).toBeTruthy();
    expect(getReport).not.toHaveBeenCalled();
  });
});

describe("ReportFullscreen - sair", () => {
  it("o botao Sair volta para a pagina de onde a pessoa veio", async () => {
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByTestId("embed");

    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }));

    expect(await screen.findByText("pagina da colecao")).toBeTruthy();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });

  it("o Esc faz o mesmo", async () => {
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByTestId("embed");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("pagina da colecao")).toBeTruthy();
  });

  it("endereco aberto direto (sem pagina anterior) vai para a colecao e a deixa selecionada", async () => {
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }));

    expect(await screen.findByText("pagina da colecao")).toBeTruthy();
    expect(mocks.selectWorkspace).toHaveBeenCalledWith(3);
  });

  it("sair funciona mesmo quando o relatorio deu erro", async () => {
    getReport.mockRejectedValue(new Error("rede"));
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByText("Nao foi possivel abrir o relatorio.");

    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia (Esc)" }));

    await waitFor(() => expect(screen.getByText("pagina da colecao")).toBeTruthy());
  });
});

describe("ReportFullscreen - exportar", () => {
  it("quem pode exportar na colecao ve o botao com PDF e imagem liberados", async () => {
    mocks.permissoes = ["colecao.ver", "relatorio.exportar"];
    abrir(["/collection/3/report/34"]);

    expect(await screen.findByRole("button", { name: "Exportar (com arquivo)" })).toBeTruthy();
  });

  it("quem nao pode exportar continua vendo o botao, so com as tabelas", async () => {
    abrir(["/collection/3/report/34"]);

    expect(await screen.findByRole("button", { name: "Exportar (so tabelas)" })).toBeTruthy();
  });

  it("o botao antigo Exportar CSV nao existe mais", async () => {
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    expect(screen.queryByRole("button", { name: /Exportar CSV/ })).toBeNull();
  });
});

describe("ReportFullscreen - assinatura", () => {
  it("sem permissao nao ha botao Assinar", async () => {
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    expect(screen.queryByRole("button", { name: /Assinar/ })).toBeNull();
  });

  it("com permissao o botao abre a janela de assinaturas", async () => {
    mocks.access = { canSubscribe: true, allowedDomains: [] };
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    fireEvent.click(screen.getByRole("button", { name: /Assinar/ }));

    expect(screen.getByText("janela de assinaturas")).toBeTruthy();
  });

  it("com a janela aberta o Esc nao sai da tela cheia", async () => {
    mocks.access = { canSubscribe: true, allowedDomains: [] };
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByTestId("embed");
    fireEvent.click(screen.getByRole("button", { name: /Assinar/ }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText("pagina da colecao")).toBeNull();
    expect(screen.getByText("janela de assinaturas")).toBeTruthy();
  });

  it("fechada a janela, o Esc volta a sair", async () => {
    mocks.access = { canSubscribe: true, allowedDomains: [] };
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByTestId("embed");
    fireEvent.click(screen.getByRole("button", { name: /Assinar/ }));
    fireEvent.click(screen.getByRole("button", { name: "fechar janela" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("pagina da colecao")).toBeTruthy();
  });
});

describe("ReportFullscreen - chat", () => {
  const abrirChat = () => screen.getByRole("button", { name: "Abrir o chat ao lado da pagina" });

  it("a barra do relatorio tem o botao do chat e ele abre o painel ao lado do relatorio", async () => {
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    fireEvent.click(abrirChat());

    expect(await screen.findByLabelText("Sua pergunta")).toBeTruthy();
    expect(screen.getByTestId("embed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fechar o chat lateral" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sem a permissao de usar o chat o botao nao aparece", async () => {
    mocks.canUseChat = false;
    abrir(["/collection/3/report/34"]);
    await screen.findByTestId("embed");

    expect(screen.queryByRole("button", { name: /chat ao lado|chat lateral/ })).toBeNull();
  });

  it("o painel aberto e o rascunho continuam ao entrar no relatorio", async () => {
    abrir(["/collection"]);
    fireEvent.click(abrirChat());
    fireEvent.change(await screen.findByLabelText("Sua pergunta"), { target: { value: "vidas por estado" } });

    fireEvent.click(screen.getByText("abrir relatorio"));
    await screen.findByTestId("embed");

    expect((screen.getByLabelText("Sua pergunta") as HTMLTextAreaElement).value).toBe("vidas por estado");
  });

  it("o Esc dentro do chat nao sai do relatorio, mas fora dele sai", async () => {
    abrir(["/collection", "/collection/3/report/34"]);
    await screen.findByTestId("embed");
    fireEvent.click(abrirChat());

    fireEvent.keyDown(await screen.findByLabelText("Sua pergunta"), { key: "Escape" });
    expect(screen.queryByText("pagina da colecao")).toBeNull();
    expect(screen.getByTestId("embed")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("pagina da colecao")).toBeTruthy();
  });
});
