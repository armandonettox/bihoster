/** "90" vira "1 min 30 s": o tempo da volta completa da TV, em palavras curtas. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Opcoes de quanto tempo a TV fica conectada depois de digitar o codigo (null = para sempre). */
export const SESSION_OPTIONS: { hours: number | null; label: string }[] = [
  { hours: 1, label: "1 hora" },
  { hours: 8, label: "8 horas" },
  { hours: 24, label: "1 dia" },
  { hours: 24 * 7, label: "7 dias" },
  { hours: 24 * 30, label: "30 dias" },
  { hours: 24 * 90, label: "90 dias" },
  { hours: null, label: "Para sempre" },
];

export function sessionLabel(hours: number | null): string {
  const known = SESSION_OPTIONS.find((o) => o.hours === hours);
  if (known) return known.label;
  return hours === 1 ? "1 hora" : `${hours} horas`;
}
