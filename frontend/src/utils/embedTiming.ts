import { safeStorage } from "./safeStorage";

const DEBUG_KEY = "bihoster_debug_embed";

/** Uma linha de medicao: quanto cada etapa de abrir um relatorio levou, em milissegundos. */
export interface EmbedTimingRow {
  relatorio: number;
  /** Buscar a configuracao e o token no backend */
  config_ms: number | null;
  /** Do pedido ao Power BI ate o relatorio avisar que carregou (aplicativo + modelo) */
  embed_ate_carregar_ms: number | null;
  /** De carregado ate os visuais desenhados (consultas ao modelo + desenho) */
  carregar_ate_desenhar_ms: number | null;
  /** Do inicio ate os visuais desenhados */
  total_ms: number | null;
  /** O relatorio falhou antes de desenhar */
  erro: boolean;
  /** Foi iniciada a pre-carga dos recursos do Power BI nesta pagina */
  pre_carregado: boolean;
}

declare global {
  interface Window {
    /** Medicoes dos relatorios abertos nesta pagina (so com a medicao ligada) */
    __bihosterEmbed?: EmbedTimingRow[];
  }
}

/** A medicao e desligada por padrao. `?debug=embed` na URL liga e lembra (ate `?debug=off`); com ela
 * ligada, cada relatorio aberto escreve uma linha no console (F12) e em `window.__bihosterEmbed`. */
export function isEmbedTimingEnabled(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get("debug");
    if (flag === "embed") safeStorage.setItem(DEBUG_KEY, "1");
    if (flag === "off") safeStorage.removeItem(DEBUG_KEY);
  } catch {
    // URL ilegivel: segue com o que estiver guardado
  }
  return safeStorage.getItem(DEBUG_KEY) === "1";
}

type Mark = "config" | "embed" | "loaded" | "rendered";

function delta(marks: Partial<Record<Mark, number>>, from: Mark | null, to: Mark): number | null {
  const end = marks[to];
  if (end === undefined) return null;
  const start = from === null ? 0 : marks[from];
  if (start === undefined) return null;
  return Math.round(end - start);
}

/** Cronometro de um relatorio. `mark` registra o instante de cada etapa (so o primeiro de cada) e
 * `finish` fecha a medicao: escreve no console e em `window.__bihosterEmbed` quando ligada. */
export function createEmbedTimer(
  reportId: number,
  options: { enabled?: boolean; preloaded?: boolean; now?: () => number } = {},
) {
  const enabled = options.enabled ?? isEmbedTimingEnabled();
  const now = options.now ?? (() => performance.now());
  const start = now();
  const marks: Partial<Record<Mark, number>> = {};
  let finished = false;

  return {
    mark(name: Mark) {
      if (marks[name] === undefined) marks[name] = now() - start;
    },
    finish(failed = false): EmbedTimingRow | null {
      if (finished) return null;
      finished = true;
      const row: EmbedTimingRow = {
        relatorio: reportId,
        config_ms: delta(marks, null, "config"),
        embed_ate_carregar_ms: delta(marks, "embed", "loaded"),
        carregar_ate_desenhar_ms: delta(marks, "loaded", "rendered"),
        total_ms: delta(marks, null, "rendered"),
        erro: failed,
        pre_carregado: options.preloaded ?? false,
      };
      if (enabled) {
        (window.__bihosterEmbed ??= []).push(row);
        console.info("[bihoster] relatorio aberto", row);
      }
      return row;
    },
  };
}
