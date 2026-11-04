import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "./useEscapeKey";

describe("useEscapeKey", () => {
  it("chama a funcao quando o Esc e apertado", () => {
    const sair = vi.fn();
    renderHook(() => useEscapeKey(sair));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("ignora as outras teclas", () => {
    const sair = vi.fn();
    renderHook(() => useEscapeKey(sair));

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });

    expect(sair).not.toHaveBeenCalled();
  });

  it("nao escuta quando esta desligado", () => {
    const sair = vi.fn();
    renderHook(() => useEscapeKey(sair, false));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(sair).not.toHaveBeenCalled();
  });

  it("usa sempre a funcao mais recente, sem recriar o ouvinte", () => {
    const adicionar = vi.spyOn(document, "addEventListener");
    const primeira = vi.fn();
    const segunda = vi.fn();
    const { rerender } = renderHook(({ fn }) => useEscapeKey(fn), { initialProps: { fn: primeira } });
    const registros = adicionar.mock.calls.filter(([tipo]) => tipo === "keydown").length;

    rerender({ fn: segunda });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(primeira).not.toHaveBeenCalled();
    expect(segunda).toHaveBeenCalledTimes(1);
    expect(adicionar.mock.calls.filter(([tipo]) => tipo === "keydown").length).toBe(registros);
    adicionar.mockRestore();
  });

  it("solta o ouvinte ao sair da tela", () => {
    const sair = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(sair));

    unmount();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(sair).not.toHaveBeenCalled();
  });
});
