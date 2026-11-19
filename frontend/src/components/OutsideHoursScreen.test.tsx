import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { OUTSIDE_HOURS_EVENT, formatNextOpen, outsideHoursFrom } from "../utils/outsideHours";
import type { OutsideHoursInfo } from "../utils/outsideHours";

vi.mock("../api/auth", () => ({ me: vi.fn(), refreshSession: vi.fn(), login: vi.fn(), loginWithGoogle: vi.fn(), updateName: vi.fn(), changePassword: vi.fn() }));

const me = vi.mocked(authApi.me);

const INFO: OutsideHoursInfo = {
  code: "outside_hours",
  message: "Você está fora do horário de acesso.",
  next_open: "2026-11-23T08:00:00-03:00",
  windows: ["Seg a Sex, 08:00 às 18:00"],
  timezone: "America/Sao_Paulo",
};

function App() {
  const { user } = useAuth();
  return <p>{user ? `logada: ${user.name}` : "sem usuario"}</p>;
}

beforeEach(() => {
  me.mockReset();
  localStorage.clear();
  localStorage.setItem("token", "abc");
});

describe("outsideHoursFrom", () => {
  it("so reconhece o 403 com codigo outside_hours", () => {
    expect(outsideHoursFrom({ response: { status: 403, data: { detail: INFO } } })).toEqual(INFO);
    expect(outsideHoursFrom({ response: { status: 403, data: { detail: "Sem permissao" } } })).toBeNull();
    expect(outsideHoursFrom({ response: { status: 401, data: { detail: INFO } } })).toBeNull();
    expect(outsideHoursFrom(new Error("rede"))).toBeNull();
  });

  it("escreve quando o acesso volta no fuso do sistema", () => {
    expect(formatNextOpen(INFO)).toMatch(/segunda-feira/i);
    expect(formatNextOpen(INFO)).toContain("08:00");
    expect(formatNextOpen({ ...INFO, next_open: null })).toBeNull();
  });
});

describe("AuthProvider fora do horario", () => {
  it("o aviso troca o app inteiro, com o horario e quando volta, sem apagar a sessao", async () => {
    me.mockResolvedValue({ id: 1, name: "Ana", email: "a@x.com" } as never);
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByText("logada: Ana");

    window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));

    expect(await screen.findByText("Fora do horário de acesso")).toBeTruthy();
    expect(screen.getByText("Seg a Sex, 08:00 às 18:00")).toBeTruthy();
    expect(screen.getByText(/O seu acesso volta em segunda-feira/i)).toBeTruthy();
    expect(screen.queryByText("logada: Ana")).toBeNull();
    expect(localStorage.getItem("token")).toBe("abc");
  });

  it("tentar de novo volta ao app quando o horario abriu", async () => {
    me.mockResolvedValueOnce({ id: 1, name: "Ana", email: "a@x.com" } as never);
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByText("logada: Ana");
    window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));
    await screen.findByText("Fora do horário de acesso");

    me.mockResolvedValueOnce({ id: 1, name: "Ana", email: "a@x.com" } as never);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(screen.getByText("logada: Ana")).toBeTruthy());
    expect(screen.queryByText("Fora do horário de acesso")).toBeNull();
  });

  it("ao abrir o app fora do horario, o token fica e o aviso aparece", async () => {
    me.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent(OUTSIDE_HOURS_EVENT, { detail: INFO }));
      throw { response: { status: 403, data: { detail: INFO } } };
    });
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );

    expect(await screen.findByText("Fora do horário de acesso")).toBeTruthy();
    expect(localStorage.getItem("token")).toBe("abc");
  });
});
