/** "2026-11-10" vira "10/11" */
export function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export type AuditPeriod = "today" | "7d" | "30d" | "90d" | "all" | "custom";

export const PERIOD_OPTIONS: { value: AuditPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" },
  { value: "90d", label: "Ultimos 90 dias" },
  { value: "all", label: "Todo o periodo" },
  { value: "custom", label: "Personalizado" },
];

/** Hoje (YYYY-MM-DD) no fuso informado, para o periodo valer no mesmo fuso que o servidor usa. */
export function todayIn(timezone: string | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Datas do filtro para o periodo escolhido. "Tudo" nao manda data; "7 dias" inclui hoje. */
export function periodRange(
  period: AuditPeriod,
  timezone: string | undefined,
  custom: { from: string; to: string },
  now: Date = new Date(),
): { date_from?: string; date_to?: string } {
  const today = todayIn(timezone, now);
  switch (period) {
    case "today":
      return { date_from: today, date_to: today };
    case "7d":
      return { date_from: shiftDays(today, -6), date_to: today };
    case "30d":
      return { date_from: shiftDays(today, -29), date_to: today };
    case "90d":
      return { date_from: shiftDays(today, -89), date_to: today };
    case "custom":
      return { date_from: custom.from || undefined, date_to: custom.to || undefined };
    default:
      return {};
  }
}
