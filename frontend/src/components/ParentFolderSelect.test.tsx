import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MyAccess } from "../api/access";
import type { Workspace } from "../api/workspaces";
import { AccessContext, buildAccess } from "../context/AccessContext";
import ParentFolderSelect from "./ParentFolderSelect";

function ws(id: number, name: string): Workspace {
  return { id, name, slug: name, description: null, icon: null, color: null, role: "admin" };
}

function renderSelect(me: Partial<MyAccess>, props: Partial<Parameters<typeof ParentFolderSelect>[0]> = {}) {
  const onChange = vi.fn();
  const access = buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...me });
  render(
    <AccessContext.Provider value={access}>
      <ParentFolderSelect workspaces={[ws(1, "Financeiro"), ws(2, "Comercial"), ws(3, "Custos")]} value={null} onChange={onChange} {...props} />
    </AccessContext.Provider>,
  );
  return onChange;
}

describe("ParentFolderSelect", () => {
  it("so lista as pastas onde a pessoa pode criar subpastas, e a opcao de topo se pode criar colecoes", () => {
    renderSelect({ global_permissions: ["colecao.criar"], workspace_permissions: { "1": ["colecao.criar-subpasta"] } });

    const opcoes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual(["Nenhuma (pasta de topo)", "Financeiro"]);
  });

  it("sem poder criar no topo, nao oferece Nenhuma", () => {
    renderSelect({ workspace_permissions: { "1": ["colecao.criar-subpasta"] } }, { value: 1 });

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Financeiro"]);
  });

  it("some quando a pessoa nao pode criar subpasta em lugar nenhum", () => {
    const { container } = render(
      <AccessContext.Provider value={buildAccess({ is_admin: false, global_permissions: ["colecao.criar"], workspace_permissions: {} })}>
        <ParentFolderSelect workspaces={[ws(1, "Financeiro")]} value={null} onChange={() => {}} />
      </AccessContext.Provider>,
    );

    expect(container.textContent).toBe("");
  });

  it("tira da lista a propria pasta e as de dentro dela", () => {
    renderSelect({ is_admin: true }, { excludeIds: [1, 3] });

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Nenhuma (pasta de topo)", "Comercial"]);
  });

  it("avisa a escolha, e Nenhuma devolve null", () => {
    const onChange = renderSelect({ is_admin: true }, { value: 2 });

    fireEvent.change(screen.getByLabelText("Dentro de"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Dentro de"), { target: { value: "" } });

    expect(onChange).toHaveBeenNthCalledWith(1, 3);
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });
});
