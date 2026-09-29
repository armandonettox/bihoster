import { describe, expect, it } from "vitest";
import { loginUrlFor, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("aceita caminhos internos", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/collection?tab=tv")).toBe("/collection?tab=tv");
    expect(safeNextPath("/tv/3")).toBe("/tv/3");
  });

  it("cai na raiz quando nao ha destino", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("recusa URL externa e formas que o navegador trata como outro dominio (open redirect)", () => {
    expect(safeNextPath("https://evil.example.com/x")).toBe("/");
    expect(safeNextPath("//evil.example.com/x")).toBe("/");
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("evil.example.com")).toBe("/");
  });

  it("nao volta pra propria tela de login (evita loop)", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=%2Fsettings")).toBe("/");
  });
});

describe("loginUrlFor", () => {
  it("guarda a pagina pedida em ?next=", () => {
    expect(loginUrlFor("/settings")).toBe("/login?next=%2Fsettings");
    expect(loginUrlFor("/collection?tab=tv")).toBe("/login?next=%2Fcollection%3Ftab%3Dtv");
  });

  it("nao guarda destino quando ele e a raiz ou o proprio login", () => {
    expect(loginUrlFor("/")).toBe("/login");
    expect(loginUrlFor("")).toBe("/login");
    expect(loginUrlFor("/login")).toBe("/login");
  });

  it("o que loginUrlFor grava, safeNextPath le de volta igual (ida e volta)", () => {
    const url = new URL(loginUrlFor("/collection?tab=tv"), "http://x");
    expect(safeNextPath(url.searchParams.get("next"))).toBe("/collection?tab=tv");
  });
});
