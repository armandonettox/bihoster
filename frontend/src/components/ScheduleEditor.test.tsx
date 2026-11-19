import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schedulesApi from "../api/schedules";
import ScheduleEditor from "./ScheduleEditor";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../api/schedules", () => ({ getSchedule: vi.fn(), setSchedule: vi.fn() }));

const getSchedule = vi.mocked(schedulesApi.getSchedule);
const setSchedule = vi.mocked(schedulesApi.setSchedule);

const SEG_A_SEX = { days: [0, 1, 2, 3, 4], start: "08:00", end: "18:00" };
const TUDO = { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "24:00" };

function carregar(ranges: schedulesApi.ScheduleRange[]) {
  getSchedule.mockResolvedValue({ ranges, timezone: "America/Sao_Paulo" });
  setSchedule.mockImplementation(async (_k, _i, enviadas) => ({ ranges: enviadas, timezone: "America/Sao_Paulo" }));
}

beforeEach(() => {
  mocks.showToast.mockClear();
  getSchedule.mockReset();
  setSchedule.mockReset();
});

describe("ScheduleEditor - grupo", () => {
  it("sem faixas diz que nao ha limite e mostra o fuso", async () => {
    carregar([]);
    render(<ScheduleEditor kind="group" id={5} />);

    expect(await screen.findByText("Nenhuma faixa: sem limite de horário.")).toBeTruthy();
    expect(screen.getByText(/America\/Sao_Paulo/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Salvar horário" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("adiciona uma faixa, muda dias e horas e salva o que foi montado", async () => {
    carregar([]);
    render(<ScheduleEditor kind="group" id={5} />);
    await screen.findByText("Nenhuma faixa: sem limite de horário.");

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar faixa" }));
    fireEvent.click(screen.getByRole("button", { name: "Sábado" })); // liga o sabado
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira" })); // desliga a segunda
    fireEvent.change(screen.getByLabelText("Início da faixa 1"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByLabelText("Fim da faixa 1"), { target: { value: "00:00" } }); // meia-noite = fim do dia
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));

    await waitFor(() => expect(setSchedule).toHaveBeenCalledWith("group", 5, [{ days: [1, 2, 3, 4, 5], start: "09:30", end: "24:00" }]));
    expect(mocks.showToast).toHaveBeenCalledWith("Horário de acesso salvo.");
  });

  it("remove faixas e salva a lista vazia (sem limite)", async () => {
    carregar([SEG_A_SEX]);
    render(<ScheduleEditor kind="group" id={5} />);
    await screen.findByLabelText("Início da faixa 1");

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));

    await waitFor(() => expect(setSchedule).toHaveBeenCalledWith("group", 5, []));
  });

  it("so ver: tudo travado e sem salvar nem adicionar", async () => {
    carregar([SEG_A_SEX]);
    render(<ScheduleEditor kind="group" id={5} readOnly />);
    await screen.findByLabelText("Início da faixa 1");

    expect(screen.queryByRole("button", { name: "Salvar horário" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Adicionar faixa" })).toBeNull();
    expect((screen.getByLabelText("Início da faixa 1") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
  });

  it("erro do servidor aparece na mensagem", async () => {
    carregar([]);
    setSchedule.mockRejectedValue({ response: { data: { detail: "O início e o fim da faixa não podem ser iguais." } } });
    render(<ScheduleEditor kind="group" id={5} />);
    await screen.findByText("Nenhuma faixa: sem limite de horário.");
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar faixa" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith("O início e o fim da faixa não podem ser iguais.", "error"));
  });
});

describe("ScheduleEditor - excecao da pessoa", () => {
  const modo = (nome: RegExp) => screen.getByRole("radio", { name: nome }) as HTMLInputElement;

  it("sem faixas segue os grupos e nao mostra a lista de faixas", async () => {
    carregar([]);
    render(<ScheduleEditor kind="user" id={7} />);
    await screen.findByText("Seguir o horário dos grupos");

    expect(modo(/Seguir o horário dos grupos/).checked).toBe(true);
    expect(screen.queryByText("+ Adicionar faixa")).toBeNull();
  });

  it("reconhece a excecao sem limite", async () => {
    carregar([TUDO]);
    render(<ScheduleEditor kind="user" id={7} />);
    await screen.findByText("Seguir o horário dos grupos");

    expect(modo(/sem limite de horário/).checked).toBe(true);
  });

  it("sem limite salva a semana inteira, e voltar a seguir os grupos salva vazio", async () => {
    carregar([SEG_A_SEX]);
    render(<ScheduleEditor kind="user" id={7} />);
    await screen.findByText("Seguir o horário dos grupos");

    fireEvent.click(modo(/sem limite de horário/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(setSchedule).toHaveBeenCalledWith("user", 7, [TUDO]));

    fireEvent.click(modo(/Seguir o horário dos grupos/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
    await waitFor(() => expect(setSchedule).toHaveBeenLastCalledWith("user", 7, []));
  });

  it("voltar para faixas proprias recupera as que a pessoa tinha montado", async () => {
    carregar([SEG_A_SEX]);
    render(<ScheduleEditor kind="user" id={7} />);
    await screen.findByText("Seguir o horário dos grupos");

    fireEvent.click(modo(/Seguir o horário dos grupos/));
    fireEvent.click(modo(/faixas próprias/));

    expect((screen.getByLabelText("Início da faixa 1") as HTMLInputElement).value).toBe("08:00");
  });
});
