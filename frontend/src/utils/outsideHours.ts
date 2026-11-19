/** O que o servidor manda quando a pessoa está fora do horário de acesso (detalhe do erro 403). */
export interface OutsideHoursInfo {
  code: "outside_hours";
  message: string;
  next_open: string | null;
  windows: string[];
  timezone: string;
}

export const OUTSIDE_HOURS_EVENT = "bihoster:outside-hours";

/** Devolve o aviso se o erro do axios é de "fora do horário"; senão, null. */
export function outsideHoursFrom(err: any): OutsideHoursInfo | null {
  const detail = err?.response?.data?.detail;
  return err?.response?.status === 403 && detail && typeof detail === "object" && detail.code === "outside_hours" ? detail : null;
}

/** Quando o acesso volta, escrito no fuso do sistema: "segunda-feira, 08:00". */
export function formatNextOpen(info: OutsideHoursInfo): string | null {
  if (!info.next_open) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: info.timezone || undefined,
    }).format(new Date(info.next_open));
  } catch {
    return null;
  }
}
