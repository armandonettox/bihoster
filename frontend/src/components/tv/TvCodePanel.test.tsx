import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tvsApi from "../../api/tvs";
import TvCodePanel from "./TvCodePanel";

vi.mock("../../api/tvs", () => ({ getTvCode: vi.fn() }));
const getTvCode = vi.mocked(tvsApi.getTvCode);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TvCodePanel", () => {
  it("mostra o codigo em dois grupos de tres digitos e quanto falta para mudar", async () => {
    getTvCode.mockResolvedValue({ code: "123456", expires_in_seconds: 125, step_seconds: 300 });

    render(<TvCodePanel tvId={5} />);

    expect(await screen.findByText("123 456")).toBeTruthy();
    expect(screen.getByText("Muda em 2:05")).toBeTruthy();
    expect(getTvCode).toHaveBeenCalledWith(5);
  });

  it("a contagem anda e, quando acaba, busca o codigo novo sozinha", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getTvCode
      .mockResolvedValueOnce({ code: "111111", expires_in_seconds: 3, step_seconds: 300 })
      .mockResolvedValue({ code: "222222", expires_in_seconds: 300, step_seconds: 300 });
    render(<TvCodePanel tvId={5} />);
    expect(await screen.findByText("111 111")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByText("Muda em 0:02")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });

    await waitFor(() => expect(screen.getByText("222 222")).toBeTruthy());
    expect(getTvCode).toHaveBeenCalledTimes(2);
  });

  it("erro ao buscar mostra o motivo", async () => {
    getTvCode.mockRejectedValue({ response: { data: { detail: "TV nao encontrada" } } });

    render(<TvCodePanel tvId={5} />);

    expect(await screen.findByText("TV nao encontrada")).toBeTruthy();
  });
});
