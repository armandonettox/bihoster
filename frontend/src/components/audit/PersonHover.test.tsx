import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditPerson } from "../../api/audit";
import PersonHover from "./PersonHover";

const PERSON: AuditPerson = {
  id: 7,
  name: "Ana Lima",
  email: "ana@empresa.com",
  is_platform_admin: true,
  groups: ["Todos os usuarios", "Administradores"],
  created_at: "2026-03-05T12:00:00Z",
  last_login_at: "2026-11-10T15:00:00Z",
  login_provider: "google",
  picture_url: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const trigger = (name: string) => screen.getByRole("button", { name });

describe("PersonHover", () => {
  it("mostra so o nome ate o cursor passar por cima", () => {
    render(<PersonHover name="Ana Lima" email="ana@empresa.com" person={PERSON} />);
    expect(trigger("Ana Lima")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("ao passar o cursor abre o cartao com email, tipo de acesso, grupos, desde quando e ultimo login", () => {
    render(<PersonHover name="Ana Lima" email="ana@empresa.com" person={PERSON} timezone="America/Sao_Paulo" />);

    fireEvent.mouseEnter(trigger("Ana Lima"));

    const card = screen.getByRole("group", { name: "Detalhes de Ana Lima" });
    expect(card.textContent).toContain("ana@empresa.com");
    expect(card.textContent).toContain("Administrador da plataforma");
    expect(card.textContent).toContain("Login pelo Google");
    expect(card.textContent).toContain("Todos os usuarios, Administradores");
    expect(card.textContent).toContain("5 de março de 2026");
    expect(card.textContent).toContain("10/11/2026");
  });

  it("o cartao nao some de repente: da tempo de levar o cursor ate ele", () => {
    render(<PersonHover name="Ana Lima" email="ana@empresa.com" person={PERSON} />);
    fireEvent.mouseEnter(trigger("Ana Lima"));
    fireEvent.mouseLeave(trigger("Ana Lima"));

    // O cursor entra no cartao antes do atraso acabar: continua aberto
    fireEvent.mouseEnter(screen.getByRole("group"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("group")).not.toBeNull();

    // Saindo do cartao, fecha depois do atraso
    fireEvent.mouseLeave(screen.getByRole("group"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("abre tambem pelo teclado (foco) e Esc fecha", () => {
    render(<PersonHover name="Ana Lima" email="ana@empresa.com" person={PERSON} />);

    fireEvent.focus(trigger("Ana Lima"));
    expect(screen.queryByRole("group")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("o botao do cartao filtra por aquela pessoa e fecha o cartao", () => {
    const onFilter = vi.fn();
    render(<PersonHover name="Ana Lima" email="ana@empresa.com" person={PERSON} onFilter={onFilter} />);
    fireEvent.mouseEnter(trigger("Ana Lima"));

    fireEvent.click(screen.getByRole("button", { name: /Filtrar por esta pessoa/ }));

    expect(onFilter).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("conta comum com senha nao mostra a etiqueta do Google e nunca logou mostra o aviso", () => {
    render(
      <PersonHover
        name="Bruno Sa"
        email="bruno@empresa.com"
        person={{
          ...PERSON,
          id: 8,
          name: "Bruno Sa",
          is_platform_admin: false,
          groups: ["Todos os usuarios"],
          login_provider: "password",
          last_login_at: null,
        }}
      />,
    );
    fireEvent.mouseEnter(trigger("Bruno Sa"));

    const card = screen.getByRole("group");
    expect(card.textContent).toContain("Usuario");
    expect(card.textContent).not.toContain("Administrador");
    expect(card.textContent).not.toContain("Login pelo Google");
    expect(card.textContent).toContain("Sem login registrado");
  });

  it("usuario removido: mostra o email gravado, avisa e nao oferece filtro", () => {
    render(<PersonHover name={null} email="saiu@empresa.com" onFilter={vi.fn()} />);
    fireEvent.mouseEnter(trigger("saiu@empresa.com"));

    const card = screen.getByRole("group");
    expect(card.textContent).toContain("Usuario removido");
    expect(card.textContent).toContain("so o email ficou registrado");
    expect(screen.queryByRole("button", { name: /Filtrar por esta pessoa/ })).toBeNull();
  });

  it("acao do sistema (sem nome nem email) e so o texto, sem cartao", () => {
    render(<PersonHover name={null} email={null} />);
    expect(screen.getByText("Sistema")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
