import { useCallback, useEffect, useReducer, useRef } from "react";

interface State {
  index: number;
  paused: boolean;
  /** Muda a cada (re)inicio da contagem do slide: reinicia o temporizador e a barra de progresso */
  epoch: number;
  /** Tempo que faltava quando pausou; nulo = o slide tem o intervalo cheio */
  remainingMs: number | null;
}

type Action =
  | { type: "step"; delta: 1 | -1; count: number }
  | { type: "pause"; remainingMs: number | null }
  | { type: "resume" }
  | { type: "clamp"; count: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "step": {
      // Com 0 ou 1 slide nao ha pra onde ir; nao reinicia a contagem a toa
      if (action.count < 2) return state;
      const index = (state.index + action.delta + action.count) % action.count;
      return { ...state, index, epoch: state.epoch + 1, remainingMs: null };
    }
    case "pause":
      return { ...state, paused: true, remainingMs: action.remainingMs };
    case "resume":
      // Mantem remainingMs: o temporizador retoma do tempo que faltava
      return { ...state, paused: false, epoch: state.epoch + 1 };
    case "clamp":
      return state.index < action.count ? state : { ...state, index: 0, epoch: state.epoch + 1, remainingMs: null };
  }
}

interface UseSlideshowOptions {
  /** Quantos slides ha */
  count: number;
  /** Tempo de cada slide, em ms */
  intervalMs: number;
  /** Falso na Apresentacao: so navega pelas setas/botoes, nunca sozinho */
  autoAdvance: boolean;
}

/**
 * Controla uma exibicao de slides (Modo TV, Apresentacao): avanco automatico, pausa, navegacao
 * manual e a contagem que a barra de progresso desenha.
 *
 * Pausar guarda o tempo que faltava e retomar continua dele (pausar aos 3s de 10s e retomar
 * troca 7s depois, nao 10s). Navegar manualmente reinicia a contagem do slide novo, senao ele
 * podia trocar logo depois de o usuario ter acabado de mexer.
 */
export function useSlideshow({ count, intervalMs, autoAdvance }: UseSlideshowOptions) {
  const [state, dispatch] = useReducer(reducer, { index: 0, paused: false, epoch: 0, remainingMs: null });
  const deadlineRef = useRef(0);

  // Se a lista encolheu e o indice saiu do intervalo, mostra o primeiro ja (sem esperar o efeito)
  const index = state.index < count ? state.index : 0;
  useEffect(() => {
    if (count > 0 && state.index >= count) dispatch({ type: "clamp", count });
  }, [count, state.index]);

  const running = autoAdvance && count >= 2 && !state.paused;
  const waitMs = state.remainingMs ?? intervalMs;

  useEffect(() => {
    if (!running) return;
    deadlineRef.current = Date.now() + waitMs;
    const timer = setTimeout(() => dispatch({ type: "step", delta: 1, count }), waitMs);
    return () => clearTimeout(timer);
  }, [running, state.epoch, waitMs, count]);

  const next = useCallback(() => dispatch({ type: "step", delta: 1, count }), [count]);
  const prev = useCallback(() => dispatch({ type: "step", delta: -1, count }), [count]);

  const togglePause = useCallback(() => {
    if (state.paused) {
      dispatch({ type: "resume" });
    } else {
      const remainingMs = running ? Math.max(0, deadlineRef.current - Date.now()) : null;
      dispatch({ type: "pause", remainingMs });
    }
  }, [state.paused, running]);

  return {
    index,
    paused: state.paused,
    next,
    prev,
    togglePause,
    /** Dados da barra de progresso: reinicia quando `key` muda, dura `durationMs` e comeca em `from` (0 a 1) */
    countdown: {
      key: state.epoch,
      durationMs: waitMs,
      from: Math.min(1, Math.max(0, 1 - waitMs / intervalMs)),
    },
  };
}
