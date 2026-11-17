import { describe, expect, it } from "vitest";
import { summarizeGroups } from "./memberGroups";

const padrao = { name: "Todos os usuários", is_default: true };
const dados = { name: "Dados", is_default: false };
const diretoria = { name: "Diretoria", is_default: false };
const financeiro = { name: "Financeiro", is_default: false };

describe("summarizeGroups", () => {
  it("padrão mais um grupo mostra só o outro grupo, sem o padrão", () => {
    const resumo = summarizeGroups([padrao, dados]);

    expect(resumo.label).toBe("Dados");
    expect(resumo.extra).toBe(0);
    expect(resumo.muted).toBe(false);
  });

  it("a ordem não importa: o padrão nunca é o nome mostrado quando há outro grupo", () => {
    expect(summarizeGroups([dados, padrao]).label).toBe("Dados");
  });

  it("padrão mais vários grupos mostra o primeiro e quantos outros há", () => {
    const resumo = summarizeGroups([padrao, dados, diretoria, financeiro]);

    expect(resumo.label).toBe("Dados");
    expect(resumo.extra).toBe(2);
  });

  it("só o padrão aparece, em cinza, porque é o único", () => {
    const resumo = summarizeGroups([padrao]);

    expect(resumo.label).toBe("Todos os usuários");
    expect(resumo.extra).toBe(0);
    expect(resumo.muted).toBe(true);
  });

  it("sem grupo nenhum mostra Nenhum grupo, em cinza", () => {
    const resumo = summarizeGroups([]);

    expect(resumo.label).toBe("Nenhum grupo");
    expect(resumo.muted).toBe(true);
    expect(resumo.extra).toBe(0);
  });

  it("a dica traz todos os grupos, inclusive o padrão que ficou escondido", () => {
    expect(summarizeGroups([padrao, dados, diretoria]).title).toBe("Todos os usuários, Dados, Diretoria");
    expect(summarizeGroups([]).title).toBe("Nenhum grupo");
  });

  it("sem o grupo padrão na lista (convite sem padrão) mostra o primeiro grupo", () => {
    const resumo = summarizeGroups([dados, diretoria]);

    expect(resumo.label).toBe("Dados");
    expect(resumo.extra).toBe(1);
  });
});
