/** Primeira linha de um CSV como lista de cabecalhos, respeitando aspas (um cabecalho pode ter virgula
 * dentro de aspas, e aspas duplicadas dentro de aspas valem uma aspa). Usada para descobrir quais campos um
 * grafico do Power BI usa, pela exportacao dele com uma linha so. */
export function csvHeaders(data: string | undefined | null): string[] {
  const line = (data ?? "").split(/\r?\n/, 1)[0] ?? "";
  const headers: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      headers.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  headers.push(current.trim());
  return headers.filter((header) => header !== "");
}
