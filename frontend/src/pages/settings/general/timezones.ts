import { getUtcOffsetLabel, getUtcOffsetMinutes } from "../../../utils/datetime";

// Lista curada -- um fuso por regiao relevante, em vez do dump completo de ~400 zonas IANA.
export const TIMEZONE_OPTIONS: { tz: string; label: string }[] = [
  { tz: "Pacific/Midway", label: "Midway, Samoa" },
  { tz: "Pacific/Honolulu", label: "Havaí" },
  { tz: "America/Anchorage", label: "Anchorage" },
  { tz: "America/Los_Angeles", label: "Los Angeles, Vancouver" },
  { tz: "America/Denver", label: "Denver, Phoenix" },
  { tz: "America/Mexico_City", label: "Cidade do México" },
  { tz: "America/Chicago", label: "Chicago, Dallas" },
  { tz: "America/Bogota", label: "Bogotá, Lima" },
  { tz: "America/New_York", label: "Nova York, Toronto" },
  { tz: "America/Manaus", label: "Manaus" },
  { tz: "America/Rio_Branco", label: "Rio Branco" },
  { tz: "America/Halifax", label: "Halifax" },
  { tz: "America/Sao_Paulo", label: "Brasília, São Paulo" },
  { tz: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { tz: "America/Noronha", label: "Fernando de Noronha" },
  { tz: "Atlantic/Azores", label: "Açores" },
  { tz: "UTC", label: "UTC" },
  { tz: "Europe/Lisbon", label: "Lisboa" },
  { tz: "Europe/London", label: "Londres, Dublin" },
  { tz: "Europe/Paris", label: "Paris, Madri, Berlim, Roma" },
  { tz: "Europe/Athens", label: "Atenas, Helsinque" },
  { tz: "Europe/Moscow", label: "Moscou" },
  { tz: "Asia/Dubai", label: "Dubai" },
  { tz: "Asia/Karachi", label: "Carachi" },
  { tz: "Asia/Kolkata", label: "Nova Délhi, Mumbai" },
  { tz: "Asia/Dhaka", label: "Daca" },
  { tz: "Asia/Bangkok", label: "Bangcoc, Jacarta" },
  { tz: "Asia/Shanghai", label: "Pequim, Xangai, Hong Kong" },
  { tz: "Asia/Tokyo", label: "Tóquio, Seul" },
  { tz: "Australia/Sydney", label: "Sydney, Melbourne" },
  { tz: "Pacific/Auckland", label: "Auckland" },
];

/** Os fusos da lista, mais o atual se ele não estiver nela, ordenados pelo deslocamento em relação ao UTC */
export function listTimezones(current: string) {
  const known = TIMEZONE_OPTIONS.some((o) => o.tz === current)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { tz: current, label: current }];

  return known
    .map((option) => ({
      ...option,
      offsetMinutes: getUtcOffsetMinutes(option.tz),
      offsetLabel: getUtcOffsetLabel(option.tz),
    }))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
}
