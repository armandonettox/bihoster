export function formatDateTime(value: string, timezone?: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: timezone,
  });
}

/** Retorna o deslocamento atual em relacao ao UTC, ex: "UTC-03:00". Considera horario de verao. */
export function getUtcOffsetLabel(timezone: string, referenceDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(referenceDate);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+0";
  return offsetPart.replace("GMT", "UTC");
}

/** Minutos de deslocamento em relacao ao UTC (para ordenacao). */
export function getUtcOffsetMinutes(timezone: string, referenceDate: Date = new Date()): number {
  const label = getUtcOffsetLabel(timezone, referenceDate);
  const match = label.match(/UTC([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}
