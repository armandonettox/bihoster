// Bloco de acentos combinantes (U+0300 a U+036F) que o normalize("NFD") separa das letras.
// Montado com fromCharCode em vez de literal na regex: os caracteres combinantes sao invisiveis e
// um editor pode normaliza-los sem avisar.
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Minusculas e sem acento: "Coleção" e "colecao" viram a mesma coisa pra comparar. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

/**
 * Filtra por nome, ignorando maiusculas e acentos. Varias palavras: todas precisam aparecer no
 * nome, em qualquer ordem. Busca literal (nada de regex, entao "(" ou ".*" nao quebram nada).
 * Consulta vazia devolve a MESMA lista (mesma referencia), pra nao causar re-render a toa.
 * Mantem a ordem original dos itens.
 */
export function filterByName<T>(items: T[], query: string, getName: (item: T) => string): T[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const name = normalizeText(getName(item));
    return words.every((word) => name.includes(word));
  });
}
