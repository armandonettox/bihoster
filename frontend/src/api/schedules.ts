import { api } from "./client";
import type { SubjectKind } from "./access";

/** De quem e o horario: de um grupo, de uma pessoa ou de um relatorio (so abre e exporta dentro das faixas). */
export type ScheduleKind = SubjectKind | "report";

/** Uma faixa de acesso: dias da semana (0 = segunda ... 6 = domingo) e horas no formato HH:MM ("24:00" só no fim). */
export interface ScheduleRange {
  days: number[];
  start: string;
  end: string;
}

export interface Schedule {
  ranges: ScheduleRange[];
  timezone: string;
}

export async function getSchedule(kind: ScheduleKind, id: number): Promise<Schedule> {
  const { data } = await api.get(`/access-schedules/${kind}s/${id}`);
  return data;
}

export async function setSchedule(kind: ScheduleKind, id: number, ranges: ScheduleRange[]): Promise<Schedule> {
  const { data } = await api.put(`/access-schedules/${kind}s/${id}`, { ranges });
  return data;
}
