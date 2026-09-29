import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Report } from "../api/reports";
import * as favoritesApi from "../api/favorites";
import { FavoritesProvider, useFavorites } from "./FavoritesContext";

vi.mock("../api/favorites");
const showToast = vi.fn();
vi.mock("./ToastContext", () => ({ useToast: () => ({ showToast }) }));

function report(id: number, name = `Relatorio ${id}`): Report {
  return {
    id,
    collection_id: 1,
    name,
    powerbi_connection_id: 1,
    pbi_workspace_id: "w",
    pbi_report_id: `r${id}`,
    pbi_dataset_id: null,
    pbi_page_name: null,
    display_type: "relatorio",
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <FavoritesProvider>{children}</FavoritesProvider>;

/** Promise que so resolve/rejeita quando o teste manda: da pra observar o estado "no meio". */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount(initial: Report[]) {
  vi.mocked(favoritesApi.listFavorites).mockResolvedValue(initial);
  const hook = renderHook(() => useFavorites(), { wrapper });
  await waitFor(() => expect(hook.result.current.favorites).toEqual(initial));
  return hook;
}

beforeEach(() => {
  showToast.mockClear();
});

describe("toggleFavorite otimista", () => {
  it("remove da lista na hora, antes de a API responder", async () => {
    const { result } = await mount([report(1), report(2)]);
    const call = deferred();
    vi.mocked(favoritesApi.removeFavorite).mockReturnValue(call.promise);

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.toggleFavorite(1);
    });

    // A API ainda nao respondeu, mas a estrela ja mudou
    expect(result.current.favoriteIds.has(1)).toBe(false);
    expect(result.current.favoriteIds.has(2)).toBe(true);

    call.resolve();
    await act(() => pending);
  });

  it("adiciona na hora quando recebe o relatorio", async () => {
    const { result } = await mount([]);
    const call = deferred();
    vi.mocked(favoritesApi.addFavorite).mockReturnValue(call.promise);

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.toggleFavorite(7, report(7));
    });

    expect(result.current.favoriteIds.has(7)).toBe(true);
    expect(result.current.favorites.map((f) => f.id)).toEqual([7]);

    call.resolve();
    await act(() => pending);
  });

  it("volta ao estado anterior e avisa quando a API falha ao remover", async () => {
    const { result } = await mount([report(1), report(2)]);
    vi.mocked(favoritesApi.removeFavorite).mockRejectedValue(new Error("falhou"));

    await act(() => result.current.toggleFavorite(1));

    expect(result.current.favoriteIds.has(1)).toBe(true);
    expect(result.current.favorites.map((f) => f.id)).toEqual([1, 2]);
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("volta ao estado anterior quando a API falha ao adicionar", async () => {
    const { result } = await mount([report(1)]);
    vi.mocked(favoritesApi.addFavorite).mockRejectedValue(new Error("falhou"));

    await act(() => result.current.toggleFavorite(9, report(9)));

    expect(result.current.favoriteIds.has(9)).toBe(false);
    expect(result.current.favorites.map((f) => f.id)).toEqual([1]);
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("ignora o segundo clique enquanto o primeiro nao terminou (duplo clique)", async () => {
    const { result } = await mount([report(1)]);
    const call = deferred();
    vi.mocked(favoritesApi.removeFavorite).mockReturnValue(call.promise);

    let first!: Promise<void>;
    act(() => {
      first = result.current.toggleFavorite(1);
    });
    await act(() => result.current.toggleFavorite(1));

    expect(favoritesApi.removeFavorite).toHaveBeenCalledTimes(1);
    expect(favoritesApi.addFavorite).not.toHaveBeenCalled();

    call.resolve();
    await act(() => first);
  });

  it("sem o relatorio, adicionar segue o caminho antigo: espera a API e recarrega a lista", async () => {
    const { result } = await mount([]);
    vi.mocked(favoritesApi.addFavorite).mockResolvedValue();
    vi.mocked(favoritesApi.listFavorites).mockResolvedValue([report(5)]);

    await act(() => result.current.toggleFavorite(5));

    await waitFor(() => expect(result.current.favoriteIds.has(5)).toBe(true));
  });

  it("a falha de um favorito nao desfaz outro que deu certo no meio tempo", async () => {
    const { result } = await mount([]);
    // "Servidor" de mentira: so guarda o que a API confirmou, como um servidor real faria
    const server: Report[] = [];
    vi.mocked(favoritesApi.listFavorites).mockImplementation(async () => [...server]);
    const pendingFirst = deferred();
    vi.mocked(favoritesApi.addFavorite).mockImplementation(async (id: number) => {
      if (id === 1) return pendingFirst.promise; // fica pendente e depois falha
      server.push(report(id));
    });

    let first!: Promise<void>;
    act(() => {
      first = result.current.toggleFavorite(1, report(1));
    });
    await act(() => result.current.toggleFavorite(2, report(2)));
    expect(result.current.favoriteIds.has(1)).toBe(true);
    expect(result.current.favoriteIds.has(2)).toBe(true);

    pendingFirst.reject(new Error("falhou"));
    await act(() => first);

    // O 1 volta atras, mas o 2 (confirmado pelo servidor) continua favoritado
    await waitFor(() => expect(result.current.favoriteIds.has(1)).toBe(false));
    expect(result.current.favoriteIds.has(2)).toBe(true);
  });
});
