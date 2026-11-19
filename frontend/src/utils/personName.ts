// Palavras de ligação do português que ficam em minúscula no meio do nome (Maria da Silva, João de Souza)
const LOWERCASE_WORDS = new Set(["da", "das", "de", "do", "dos", "e"]);

/** Nome de pessoa para exibir: a primeira letra de cada nome em maiúscula e o resto em minúscula, venha o texto em
 * caixa alta, baixa ou misturada ("ARMANDO NETTO" vira "Armando Netto"). Só muda a exibição; o cadastro fica como está. */
export function formatPersonName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLocaleLowerCase("pt-BR");
      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      // Também vale depois de hífen e apóstrofo (Ana-Maria, D'Ávila)
      return lower.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}
