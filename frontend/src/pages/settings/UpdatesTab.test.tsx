import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as systemApi from "../../api/system";
import type { ReleaseInfo, VersionStatus } from "../../api/system";
import UpdatesTab from "./UpdatesTab";

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), isAdmin: true }));

vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../../context/AccessContext", () => ({ useAccess: () => ({ isAdmin: mocks.isAdmin }) }));
vi.mock("../../api/system", () => ({
  getVersionStatus: vi.fn(),
  getVersionHistory: vi.fn(),
  applyUpdate: vi.fn(),
}));

const getStatus = vi.mocked(systemApi.getVersionStatus);
const getHistory = vi.mocked(systemApi.getVersionHistory);
const apply = vi.mocked(systemApi.applyUpdate);

function release(version: string, extra: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    version,
    name: `Título ${version}`,
    changelog: `- novidade da ${version}`,
    published_at: "2026-11-21",
    is_current: false,
    ...extra,
  };
}

function status(extra: Partial<VersionStatus> = {}): VersionStatus {
  return { current_version: "1.2.0", latest: null, has_update: false, check_failed: false, auto_update_enabled: false, ...extra };
}

const NOVA = release("1.3.0", { changelog: "- chegou a coisa nova" });

async function abrir(st: VersionStatus = status(), historico: ReleaseInfo[] = [release("1.2.0", { is_current: true }), release("1.1.0")]) {
  getStatus.mockResolvedValue(st);
  getHistory.mockResolvedValue(historico);
  render(<UpdatesTab />);
  await screen.findByText("Versão atual");
}

const botao = (nome: string) => screen.getByRole("button", { name: nome }) as HTMLButtonElement;

beforeEach(() => {
  mocks.showToast.mockClear();
  mocks.isAdmin = true;
  getStatus.mockReset();
  getHistory.mockReset();
  apply.mockReset();
});

describe("UpdatesTab - versão e histórico", () => {
  it("mostra a versão instalada e o selo de atualizado", async () => {
    await abrir();

    expect(screen.getByText("v1.2.0", { selector: "div" })).toBeTruthy();
    expect(screen.getByText("Atualizado")).toBeTruthy();
  });

  it("mostra o histórico com título e data de cada versão, e abre a versão instalada", async () => {
    await abrir();

    expect(screen.getByText("Título 1.2.0", { exact: false })).toBeTruthy();
    expect(screen.getByText("Título 1.1.0", { exact: false })).toBeTruthy();
    expect(screen.getAllByText("21/11/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("atual")).toBeTruthy();
    expect(screen.getByText("novidade da 1.2.0")).toBeTruthy();
    expect(screen.queryByText("novidade da 1.1.0")).toBeNull();
  });

  it("clicar numa versão abre o que mudou nela", async () => {
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: /v1\.1\.0/ }));

    expect(await screen.findByText("novidade da 1.1.0")).toBeTruthy();
  });

  it("sem a versão instalada na lista, abre a mais recente", async () => {
    await abrir(status({ current_version: "9.9.9" }), [release("1.2.0"), release("1.1.0")]);

    expect(screen.getByText("novidade da 1.2.0")).toBeTruthy();
  });

  it("mostra 10 versões e o resto fica atrás do botão de mostrar anteriores", async () => {
    const muitas = Array.from({ length: 14 }, (_, i) => release(`1.${14 - i}.0`));
    await abrir(status({ current_version: "1.14.0" }), muitas);

    expect(screen.getAllByRole("button", { name: /v1\.\d+\.0 —/ })).toHaveLength(10);
    fireEvent.click(botao("Mostrar versões anteriores (4)"));

    expect(screen.getAllByRole("button", { name: /v1\.\d+\.0 —/ })).toHaveLength(14);
    expect(screen.queryByRole("button", { name: /Mostrar versões anteriores/ })).toBeNull();
  });

  it("versão sem notas avisa em vez de ficar em branco", async () => {
    await abrir(status(), [release("1.2.0", { is_current: true, changelog: "" })]);

    expect(screen.getByText("Sem notas nesta versão.")).toBeTruthy();
  });

  it("o texto da versão aceita imagem do histórico", async () => {
    await abrir(status(), [release("1.2.0", { is_current: true, changelog: "- olha\n\n![Tela nova](img/tela-nova.png)" })]);

    const img = document.querySelector("img.changelog-image") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/static\/changelog\/tela-nova\.png$/);
  });

  it("avisa quando não consegue carregar o histórico, sem derrubar a versão", async () => {
    getStatus.mockResolvedValue(status());
    getHistory.mockRejectedValue(new Error("500"));
    render(<UpdatesTab />);

    expect(await screen.findByText("Não foi possível carregar o histórico de versões.")).toBeTruthy();
    expect(screen.getByText("Versão atual")).toBeTruthy();
  });

  it("build local aparece como dev e nunca como vdev", async () => {
    await abrir(status({ current_version: "dev" }), [release("1.2.0")]);

    expect(screen.getByText("dev (build local)")).toBeTruthy();
    expect(screen.queryByText("vdev")).toBeNull();
  });
});

describe("UpdatesTab - verificar e atualizar", () => {
  it("o botão de atualizar aparece para o administrador mesmo sem versão nova, desligado e com o motivo", async () => {
    await abrir();

    expect(botao("Atualizar agora").disabled).toBe(true);
    expect(screen.getByText("Você já está na versão mais recente.", { selector: "p" })).toBeTruthy();
  });

  it("quem não é administrador não vê o botão de atualizar", async () => {
    mocks.isAdmin = false;
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: true }));

    expect(screen.queryByRole("button", { name: "Atualizar agora" })).toBeNull();
    expect(botao("Verificar atualizações")).toBeTruthy();
  });

  it("com versão nova e atualização automática desligada o botão fica desligado e mostra como atualizar à mão", async () => {
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: false }));

    expect(screen.getByText("Nova versão disponível")).toBeTruthy();
    expect(botao("Atualizar agora").disabled).toBe(true);
    expect(screen.getByText("A atualização automática está desligada neste servidor.", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("ENABLE_AUTO_UPDATE=true")).toBeTruthy();
    expect(screen.getByText("chegou a coisa nova")).toBeTruthy();
  });

  it("com versão nova e atualização automática ligada o botão liga e pede confirmação", async () => {
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: true }));

    expect(botao("Atualizar agora").disabled).toBe(false);
    fireEvent.click(botao("Atualizar agora"));

    expect(screen.getByText(/de v1\.2\.0 para v1\.3\.0/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a confirmação avisa que o banco é copiado antes e que a atualização só segue se a cópia der certo", async () => {
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: true }));

    fireEvent.click(botao("Atualizar agora"));

    expect(screen.getByText(/o banco é copiado para a pasta de backups do servidor/)).toBeTruthy();
    expect(screen.getByText(/só segue se a cópia der certo/)).toBeTruthy();
  });

  it("quando a cópia do banco falha, mostra o motivo e não deixa o botão preso em Atualizando", async () => {
    apply.mockRejectedValue({ response: { data: { detail: "A atualizacao nao foi iniciada porque nao foi possivel copiar o banco antes: disco cheio" } } });
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: true }));

    fireEvent.click(botao("Atualizar agora"));
    const dialogo = screen.getByText(/de v1\.2\.0 para v1\.3\.0/).closest("div") as HTMLElement;
    fireEvent.click(within(dialogo.parentElement as HTMLElement).getByRole("button", { name: "Atualizar agora" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining("disco cheio"), "error"));
    expect(botao("Atualizar agora").disabled).toBe(false);
  });

  it("confirmar manda atualizar e avisa", async () => {
    apply.mockResolvedValue({
      status: "started",
      target_version: "1.3.0",
      log_file: "x.log",
      backup_file: "db-antes-v1.2.0-para-v1.3.0-x.db",
      message: "Atualização iniciada.",
    });
    await abrir(status({ has_update: true, latest: NOVA, auto_update_enabled: true }));

    fireEvent.click(botao("Atualizar agora"));
    const dialogo = screen.getByText(/de v1\.2\.0 para v1\.3\.0/).closest("div") as HTMLElement;
    fireEvent.click(within(dialogo.parentElement as HTMLElement).getByRole("button", { name: "Atualizar agora" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).toHaveBeenCalledWith("Atualização iniciada.", "success");
  });

  it("verificar atualizações consulta de novo, ignorando a resposta guardada, e diz que está atualizado", async () => {
    await abrir();
    getStatus.mockResolvedValue(status());

    fireEvent.click(botao("Verificar atualizações"));

    await waitFor(() => expect(getStatus).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Você já está na versão mais recente."));
  });

  it("verificar atualizações avisa quando aparece uma versão nova e mostra as notas", async () => {
    await abrir();
    getStatus.mockResolvedValue(status({ has_update: true, latest: NOVA }));

    fireEvent.click(botao("Verificar atualizações"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Nova versão disponível: v1.3.0."));
    expect(await screen.findByText("chegou a coisa nova")).toBeTruthy();
  });

  it("verificar atualizações avisa quando o GitHub não responde", async () => {
    await abrir();
    getStatus.mockResolvedValue(status({ check_failed: true }));

    fireEvent.click(botao("Verificar atualizações"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível consultar o GitHub agora.", "error"));
  });

  it("verificar atualizações avisa quando a rota falha", async () => {
    await abrir();
    getStatus.mockRejectedValue(new Error("500"));

    fireEvent.click(botao("Verificar atualizações"));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("Não foi possível verificar atualizações agora.", "error"));
  });

  it("a verificação que falhou mostra o selo de que não deu para verificar", async () => {
    await abrir(status({ check_failed: true }));

    expect(screen.getByText("Não foi possível verificar")).toBeTruthy();
  });
});
