import { describe, expect, it } from "vitest";
import type { ReportRow } from "../api/access";
import { inheritedFromReport, summarizeAccess } from "./accessInherited";

function row(overrides: Partial<ReportRow>): ReportRow {
  return {
    user_id: 2,
    name: "Maria",
    email: "maria@demo.com",
    is_admin: false,
    groups: [],
    workspace_id: 1,
    scope_label: "Vendas",
    permissions: [],
    ...overrides,
  };
}

const DO_GRUPO = { key: "relatorio.publicar", label: "Publicar relatório", groups: ["Comercial"], direct: false };
const AVULSA = { key: "relatorio.excluir", label: "Excluir relatório", groups: [], direct: true };

describe("inheritedFromReport", () => {
  it("guarda só o que vem de grupo, por escopo, com os nomes dos grupos", () => {
    const inherited = inheritedFromReport([
      row({ permissions: [DO_GRUPO, AVULSA] }),
      row({ workspace_id: null, permissions: [{ key: "ia.usar", label: "Usar o chat de IA", groups: ["Dados", "Comercial"], direct: true }] }),
    ]);

    expect(inherited).toEqual({
      "1": { "relatorio.publicar": ["Comercial"] },
      global: { "ia.usar": ["Dados", "Comercial"] },
    });
  });

  it("ignora administrador, que não tem o que travar", () => {
    expect(inheritedFromReport([row({ is_admin: true, permissions: [DO_GRUPO] })])).toEqual({});
  });
});

describe("summarizeAccess", () => {
  it("soma as permissões de todos os escopos da pessoa e marca quando há avulsa", () => {
    const summary = summarizeAccess([
      row({ permissions: [DO_GRUPO, AVULSA] }),
      row({ workspace_id: null, scope_label: "Em todo o sistema", permissions: [{ key: "ia.usar", label: "Usar o chat de IA", groups: ["Dados"], direct: false }] }),
    ]).get(2);

    expect(summary?.count).toBe(3);
    expect(summary?.hasDirect).toBe(true);
    expect(summary?.title).toBe("Vendas: Publicar relatório, Excluir relatório\nEm todo o sistema: Usar o chat de IA");
  });

  it("só grupo não conta como avulsa", () => {
    expect(summarizeAccess([row({ permissions: [DO_GRUPO] })]).get(2)?.hasDirect).toBe(false);
  });

  it("administrador vira Todas e quem não tem nada vira zero", () => {
    const resumos = summarizeAccess([
      row({ user_id: 1, is_admin: true, workspace_id: null }),
      row({ user_id: 3, workspace_id: null, scope_label: "Sem nenhuma permissão" }),
    ]);

    expect(resumos.get(1)).toMatchObject({ isAdmin: true, count: 0 });
    expect(resumos.get(3)).toMatchObject({ isAdmin: false, count: 0, hasDirect: false, title: "Nenhuma permissão" });
  });
});
