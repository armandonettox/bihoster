import { describe, expect, it } from "vitest";
import type { MyAccess } from "../api/access";
import { buildAccess } from "./AccessContext";

function acesso(parts: Partial<MyAccess>) {
  return buildAccess({ is_admin: false, global_permissions: [], workspace_permissions: {}, ...parts });
}

describe("canInReport", () => {
  it("vale o que foi dado direto no relatorio e so nele", () => {
    const access = acesso({ report_permissions: { "10": ["relatorio.ver", "relatorio.exportar"] } });

    expect(access.canInReport("relatorio.exportar", 10, 3)).toBe(true);
    expect(access.canInReport("relatorio.exportar", 11, 3)).toBe(false);
    expect(access.canIn("relatorio.exportar", 3)).toBe(false);
  });

  it("vale o que vem da colecao em qualquer relatorio dela", () => {
    const access = acesso({ workspace_permissions: { "3": ["colecao.ver", "relatorio.exportar"] } });

    expect(access.canInReport("relatorio.exportar", 99, 3)).toBe(true);
    expect(access.canInReport("relatorio.exportar", 99, 4)).toBe(false);
  });

  it("administrador pode tudo e sem ids nao pode nada", () => {
    expect(acesso({ is_admin: true }).canInReport("relatorio.exportar", 1, 1)).toBe(true);
    expect(acesso({}).canInReport("relatorio.exportar", null, null)).toBe(false);
  });
});


describe("canInConnection", () => {
  it("vale o que foi dado direto na conta e so nela", () => {
    const access = acesso({ connection_permissions: { "3": ["conexao.sincronizar"] } });

    expect(access.canInConnection("conexao.sincronizar", 3)).toBe(true);
    expect(access.canInConnection("conexao.sincronizar", 4)).toBe(false);
    expect(access.can("conexao.sincronizar")).toBe(false);
  });

  it("a permissao geral vale em qualquer conta e o administrador pode tudo", () => {
    expect(acesso({ global_permissions: ["conexao.sincronizar"] }).canInConnection("conexao.sincronizar", 9)).toBe(true);
    expect(acesso({ is_admin: true }).canInConnection("conexao.sincronizar", 9)).toBe(true);
    expect(acesso({}).canInConnection("conexao.sincronizar", null)).toBe(false);
  });
});
