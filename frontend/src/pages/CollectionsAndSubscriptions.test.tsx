import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { AccessContext, buildAccess } from "../context/AccessContext";
import Collections from "./Collections";
import Alerts from "./Alerts";
import Subscriptions from "./Subscriptions";

// As listas fazem chamadas de rede; aqui so importa quem entra e quem volta para o inicio
vi.mock("./settings/CollectionsTab", async () => (await import("../test-stubs")).tabStub("lista:colecoes"));
vi.mock("./settings/SubscriptionsTab", async () => (await import("../test-stubs")).tabStub("lista:assinaturas"));
vi.mock("./settings/AlertsTab", async () => (await import("../test-stubs")).tabStub("lista:alertas"));

function abrir(url: string, globais: string[], carregando = false) {
  const me: MyAccess = { is_admin: false, global_permissions: globais, workspace_permissions: {} };
  return render(
    <AccessContext.Provider value={buildAccess(me, carregando)}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/" element={<div data-testid="inicio">inicio</div>} />
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>,
  );
}

describe("pagina de Colecoes", () => {
  it("quem pode ver todas as colecoes ve o titulo e a lista", () => {
    abrir("/collections", ["colecao.todas"]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Coleções");
    expect(screen.getByTestId("tab-content").textContent).toBe("lista:colecoes");
  });

  it("quem nao pode volta para o inicio", () => {
    abrir("/collections", ["assinatura.todas"]);

    expect(screen.queryByTestId("inicio")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("nao decide antes de saber as permissoes", () => {
    abrir("/collections", [], true);

    expect(screen.queryByTestId("inicio")).toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });
});

describe("pagina de Assinaturas", () => {
  it("quem pode ver todas as assinaturas ve o titulo e a lista", () => {
    abrir("/subscriptions", ["assinatura.todas"]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Assinaturas");
    expect(screen.getByTestId("tab-content").textContent).toBe("lista:assinaturas");
  });

  it("quem nao pode volta para o inicio", () => {
    abrir("/subscriptions", ["colecao.todas"]);

    expect(screen.queryByTestId("inicio")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });
});

describe("pagina de Alertas", () => {
  it("quem pode ver todos os alertas ve o titulo e a lista", () => {
    abrir("/alerts", ["alerta.todas"]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Alertas");
    expect(screen.getByTestId("tab-content").textContent).toBe("lista:alertas");
  });

  it("quem nao pode volta para o inicio", () => {
    abrir("/alerts", ["assinatura.todas"]);

    expect(screen.queryByTestId("inicio")).not.toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });

  it("nao decide antes de saber as permissoes", () => {
    abrir("/alerts", [], true);

    expect(screen.queryByTestId("inicio")).toBeNull();
    expect(screen.queryByTestId("tab-content")).toBeNull();
  });
});
