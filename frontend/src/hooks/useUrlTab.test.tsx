import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useUrlTab } from "./useUrlTab";

const TABS = ["general", "members", "audit"] as const;
type Tab = (typeof TABS)[number];

function setup(initialUrl: string, storageKey?: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const [tab, setTab] = useUrlTab<Tab>(TABS, "general", { storageKey });
      const location = useLocation();
      const navigate = useNavigate();
      return { tab, setTab, search: location.search, navigate };
    },
    { wrapper },
  );
}

beforeEach(() => localStorage.clear());

describe("useUrlTab", () => {
  it("usa o padrao quando nao ha aba na URL nem lembrada", () => {
    expect(setup("/settings").result.current.tab).toBe("general");
  });

  it("le a aba da URL (link direto)", () => {
    expect(setup("/settings?tab=members").result.current.tab).toBe("members");
  });

  it("ignora aba invalida na URL e cai no padrao", () => {
    expect(setup("/settings?tab=inexistente").result.current.tab).toBe("general");
  });

  it("trocar de aba escreve ?tab= na URL", () => {
    const { result } = setup("/settings");
    act(() => result.current.setTab("audit"));
    expect(result.current.tab).toBe("audit");
    expect(new URLSearchParams(result.current.search).get("tab")).toBe("audit");
  });

  it("preserva os outros parametros da URL ao trocar de aba", () => {
    const { result } = setup("/settings?foo=1");
    act(() => result.current.setTab("members"));
    const params = new URLSearchParams(result.current.search);
    expect(params.get("foo")).toBe("1");
    expect(params.get("tab")).toBe("members");
  });

  it("lembra a ultima aba e a usa quando a URL nao traz nenhuma", () => {
    const first = setup("/settings", "k");
    act(() => first.result.current.setTab("audit"));

    expect(setup("/settings", "k").result.current.tab).toBe("audit");
  });

  it("a URL tem prioridade sobre a aba lembrada", () => {
    localStorage.setItem("k", "audit");
    expect(setup("/settings?tab=members", "k").result.current.tab).toBe("members");
  });

  it("ignora valor lembrado que nao e mais uma aba valida", () => {
    localStorage.setItem("k", "aba-removida");
    expect(setup("/settings", "k").result.current.tab).toBe("general");
  });

  it("sem storageKey nao lembra nada", () => {
    const first = setup("/settings");
    act(() => first.result.current.setTab("audit"));
    expect(localStorage.length).toBe(0);
    expect(setup("/settings").result.current.tab).toBe("general");
  });

  it("nao empilha historico a cada troca de aba (replace)", () => {
    const { result } = setup("/settings");
    act(() => result.current.setTab("members"));
    act(() => result.current.setTab("audit"));

    // Com push, voltar uma entrada mostraria "members"; com replace nao ha entrada anterior
    act(() => result.current.navigate(-1));

    expect(result.current.tab).toBe("audit");
  });
});
