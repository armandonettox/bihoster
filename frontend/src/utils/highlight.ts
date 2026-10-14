export type TextRange = [start: number, end: number];

/** Minusculas e sem acento, letra por letra, pra poder mapear de volta pra posicao no texto original. */
function foldChar(char: string): string {
  return char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Trechos do `text` a destacar para o que foi digitado, ignorando maiusculas e acentos
 * ("gestao" destaca "Gestão"). Se o texto digitado aparece inteiro, destaca esse trecho; senao,
 * destaca a primeira ocorrencia de cada palavra digitada. Devolve intervalos [inicio, fim) no
 * texto ORIGINAL, ordenados e sem sobreposicao. Busca literal: nada vira regex.
 */
export function getHighlightRanges(text: string, query: string): TextRange[] {
  const folded: string[] = [];
  // Posicao de cada caractere do texto "dobrado" no texto original
  const originalIndex: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const piece = foldChar(text[i]);
    // Por unidade UTF-16 (nao por ponto de codigo), pra os indices baterem com haystack.indexOf
    for (let k = 0; k < piece.length; k++) {
      folded.push(piece[k]);
      originalIndex.push(i);
    }
  }
  const haystack = folded.join("");

  const wholeTerm = query.trim().split(/\s+/).map(foldChar).join(" ");
  if (!wholeTerm) return [];

  const toOriginal = (start: number, length: number): TextRange => [
    originalIndex[start],
    originalIndex[start + length - 1] + 1,
  ];

  const whole = haystack.indexOf(wholeTerm);
  if (whole !== -1) return [toOriginal(whole, wholeTerm.length)];

  const ranges: TextRange[] = [];
  for (const word of wholeTerm.split(" ")) {
    const at = haystack.indexOf(word);
    if (at !== -1) ranges.push(toOriginal(at, word.length));
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged: TextRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
