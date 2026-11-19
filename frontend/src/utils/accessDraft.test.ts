import { describe, expect, it } from "vitest";
import type { AccessPermission } from "../api/access";
import {
  GLOBAL_SCOPE,
  blocksFromDraft,
  draftFromBlocks,
  removeScope,
  sameDraft,
  setFeature,
  setScope,
  togglePermission,
} from "./accessDraft";

function permission(key: string, overrides: Partial<AccessPermission> = {}): AccessPermission {
  return {
    key,
    label: key,
    description: "",
    scope: "workspace",
    section: "Seção",
    feature: null,
    feature_label: null,
    feature_description: null,
    requires: [],
    ...overrides,
  };
}

const SUBSCRIPTIONS = { feature: "assinaturas", feature_label: "Assinaturas" };
const AI = { feature: "ia-gerenciar", feature_label: "Gerenciar a IA" };

// Um catálogo pequeno com o mesmo desenho do real: tudo de coleção exige ver a coleção, e há grupos de itens
const CATALOGO: AccessPermission[] = [
  permission("colecao.ver"),
  permission("relatorio.excluir", { requires: ["colecao.ver"] }),
  permission("assinatura.ver", { ...SUBSCRIPTIONS, requires: ["colecao.ver"] }),
  permission("assinatura.criar", { ...SUBSCRIPTIONS, requires: ["colecao.ver", "assinatura.ver"] }),
  permission("assinatura.editar", { ...SUBSCRIPTIONS, requires: ["colecao.ver", "assinatura.ver"] }),
  permission("assinatura.qualquer-dominio", { ...SUBSCRIPTIONS, requires: ["colecao.ver", "assinatura.criar"] }),
  permission("ia.usar", { scope: "global" }),
  permission("ia.chaves", { scope: "global", ...AI }),
  permission("ia.modelos", { scope: "global", ...AI }),
  permission("ia.registro", { scope: "global", ...AI }),
  permission("analiticos.ver", { scope: "global" }),
  permission("analiticos.criar", { scope: "global", requires: ["analiticos.ver"] }),
];

const ASSINATURAS = ["assinatura.ver", "assinatura.criar", "assinatura.editar", "assinatura.qualquer-dominio"];
const IA = ["ia.chaves", "ia.modelos", "ia.registro"];
const sorted = (set: Set<string> | undefined) => [...(set ?? [])].sort();

describe("accessDraft", () => {
  it("ida e volta entre blocos e rascunho, global primeiro e coleções por id", () => {
    const blocks = [
      { workspace_id: 9, permissions: ["colecao.ver"] },
      { workspace_id: null, permissions: ["ia.usar"] },
      { workspace_id: 2, permissions: ["colecao.ver", "relatorio.editar"] },
    ];
    expect(blocksFromDraft(draftFromBlocks(blocks)).map((b) => b.workspace_id)).toEqual([null, 2, 9]);
  });

  it("escopo vazio não vira bloco e não conta como mudança", () => {
    const vazio = setScope({}, "3", []);
    expect(blocksFromDraft(vazio)).toEqual([]);
    expect(sameDraft(vazio, {})).toBe(true);
  });

  it("remover coleção tira o escopo inteiro", () => {
    const draft = setScope(setScope({}, "1", ["colecao.ver"]), "2", ["colecao.ver"]);
    expect(Object.keys(removeScope(draft, "1"))).toEqual(["2"]);
  });
});

describe("togglePermission", () => {
  it("ligar qualquer permissão de coleção liga também ver a coleção", () => {
    const draft = togglePermission({}, "4", "relatorio.excluir", true, CATALOGO);
    expect(sorted(draft["4"])).toEqual(["colecao.ver", "relatorio.excluir"]);
  });

  it("a exigência vale em cadeia", () => {
    const draft = togglePermission({}, "4", "assinatura.qualquer-dominio", true, CATALOGO);
    expect(sorted(draft["4"])).toEqual(["assinatura.criar", "assinatura.qualquer-dominio", "assinatura.ver", "colecao.ver"]);
  });

  it("desligar ver a coleção leva todas as permissões dela", () => {
    const comTudo = setScope({}, "4", ["colecao.ver", "relatorio.excluir", "assinatura.ver"]);
    expect(togglePermission(comTudo, "4", "colecao.ver", false, CATALOGO)["4"].size).toBe(0);
  });

  it("desligar uma exigência leva quem depende dela, em cadeia, e mantém o resto", () => {
    const comTudo = setScope({}, "4", ["colecao.ver", "relatorio.excluir", ...ASSINATURAS]);
    const draft = togglePermission(comTudo, "4", "assinatura.ver", false, CATALOGO);
    expect(sorted(draft["4"])).toEqual(["colecao.ver", "relatorio.excluir"]);
  });

  it("desligar uma permissão que ninguém exige mexe só nela", () => {
    const comTudo = setScope({}, "4", ["colecao.ver", ...ASSINATURAS]);
    expect(sorted(togglePermission(comTudo, "4", "assinatura.editar", false, CATALOGO)["4"])).toEqual([
      "assinatura.criar",
      "assinatura.qualquer-dominio",
      "assinatura.ver",
      "colecao.ver",
    ]);
  });

  it("ligar um item global não puxa ver a coleção, e criar analíticos puxa ver os analíticos", () => {
    expect(sorted(togglePermission({}, GLOBAL_SCOPE, "ia.usar", true, CATALOGO)[GLOBAL_SCOPE])).toEqual(["ia.usar"]);
    expect(sorted(togglePermission({}, GLOBAL_SCOPE, "analiticos.criar", true, CATALOGO)[GLOBAL_SCOPE])).toEqual([
      "analiticos.criar",
      "analiticos.ver",
    ]);
  });

  it("ligar um item da IA não liga os outros do grupo", () => {
    expect(sorted(togglePermission({}, GLOBAL_SCOPE, "ia.chaves", true, CATALOGO)[GLOBAL_SCOPE])).toEqual(["ia.chaves"]);
  });
});

describe("setFeature", () => {
  it("ligar o grupo liga todos os itens, com o que eles exigem", () => {
    const draft = setFeature({}, "4", ASSINATURAS, true, CATALOGO);
    expect(sorted(draft["4"])).toEqual(["assinatura.criar", "assinatura.editar", "assinatura.qualquer-dominio", "assinatura.ver", "colecao.ver"]);
  });

  it("desligar o grupo tira todos os itens e deixa o resto da coleção", () => {
    const antes = setScope({}, "4", ["colecao.ver", "relatorio.excluir", ...ASSINATURAS]);
    expect(sorted(setFeature(antes, "4", ASSINATURAS, false, CATALOGO)["4"])).toEqual(["colecao.ver", "relatorio.excluir"]);
  });

  it("ligar o grupo global da IA liga os três itens e nada além", () => {
    expect(sorted(setFeature({}, GLOBAL_SCOPE, IA, true, CATALOGO)[GLOBAL_SCOPE])).toEqual(IA);
  });

  it("o que a pessoa já recebe por grupo (travado) não entra nem sai do rascunho", () => {
    const travados = new Set(["ia.chaves"]);

    const ligado = setFeature({}, GLOBAL_SCOPE, IA, true, CATALOGO, travados);
    expect(sorted(ligado[GLOBAL_SCOPE])).toEqual(["ia.modelos", "ia.registro"]);

    const desligado = setFeature(ligado, GLOBAL_SCOPE, IA, false, CATALOGO, travados);
    expect(sorted(desligado[GLOBAL_SCOPE])).toEqual([]);
  });

  it("não mexe nos outros escopos", () => {
    const antes = setScope(setScope({}, "1", ["colecao.ver"]), GLOBAL_SCOPE, ["ia.usar"]);
    const depois = setFeature(antes, GLOBAL_SCOPE, IA, true, CATALOGO);
    expect(sorted(depois["1"])).toEqual(["colecao.ver"]);
    expect(sorted(depois[GLOBAL_SCOPE])).toEqual(["ia.chaves", "ia.modelos", "ia.registro", "ia.usar"]);
  });
});
