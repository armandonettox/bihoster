import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import { AccessContext, buildAccess } from "../context/AccessContext";
import ManageUsers from "./ManageUsers";

// O painel faz as chamadas de rede e tem teste proprio; aqui so importa quando a pagina o mostra
vi.mock("./users/UsersPanel", () => ({ default: () => <div data-testid="painel">painel de usuarios</div> }));

function renderPage(globais: string[], carregando = false) {
  const me: MyAccess = { is_admin: false, global_permissions: globais, workspace_permissions: {} };
  return render(
    <AccessContext.Provider value={buildAccess(me, carregando)}>
      <MemoryRouter initialEntries={["/users"]}>
        <Routes>
          <Route path="/users" element={<ManageUsers />} />
          <Route path="/" element={<div data-testid="inicio">inicio</div>} />
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>,
  );
}

describe("ManageUsers", () => {
  it("quem pode ver os membros abre a pagina, com o titulo e o painel", () => {
    renderPage(["membros.ver"]);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Gerenciar usuários");
    expect(screen.getByTestId("painel")).toBeTruthy();
  });

  it("quem nao tem a permissao volta para o inicio", () => {
    renderPage(["sistema.email", "relatorio.publicar"]);

    expect(screen.getByTestId("inicio")).toBeTruthy();
    expect(screen.queryByTestId("painel")).toBeNull();
  });

  it("ver os grupos tambem passa pela regra do catalogo: o servidor entrega os membros junto, entao a pagina abre", () => {
    renderPage(["membros.ver", "grupos.ver"]);

    expect(screen.getByTestId("painel")).toBeTruthy();
  });

  it("enquanto as permissoes carregam nao decide nada: nem mostra o painel nem manda embora", () => {
    renderPage([], true);

    expect(screen.queryByTestId("painel")).toBeNull();
    expect(screen.queryByTestId("inicio")).toBeNull();
  });
});
