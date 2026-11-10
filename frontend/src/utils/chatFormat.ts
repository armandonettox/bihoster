/** Nome de coluna como o Power BI devolve ("Vendas[Valor]", "[Total]") para o texto que a pessoa le
 * ("Valor", "Total"). Dentro de colchetes, "]]" quer dizer um "]" de verdade. */
export function columnLabel(name: string): string {
  const match = /\[((?:[^\]]|\]\])*)\]$/.exec(name);
  return match ? match[1].replace(/\]\]/g, "]") : name;
}

/** Valor de uma celula do resultado em texto: numero no padrao brasileiro, vazio como traco. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  if (typeof value === "boolean") return value ? "Sim" : "Nao";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Dolares em texto, com mais casas quando o valor e pequeno (uma pergunta custa centavos de centavo). */
export function formatUsd(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 6 : 2;
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}
