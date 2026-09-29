interface ReorderButtonsProps {
  /** Nome do relatorio: entra no rotulo de acessibilidade pra distinguir os botoes de cada card */
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Uma movimentacao esta em andamento: bloqueia novos cliques ate ela terminar */
  busy?: boolean;
  onMove: (direction: "up" | "down") => void;
}

/** Par de botoes subir/descer pra reordenar um relatorio dentro da secao. */
export default function ReorderButtons({ name, canMoveUp, canMoveDown, busy = false, onMove }: ReorderButtonsProps) {
  return (
    // stopPropagation: os botoes ficam dentro do card, que abre o relatorio em tela cheia ao clicar
    <span style={{ display: "inline-flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        title="Mover para cima"
        aria-label={`Mover ${name} para cima`}
        disabled={!canMoveUp || busy}
        onClick={() => onMove("up")}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          arrow_upward
        </span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        title="Mover para baixo"
        aria-label={`Mover ${name} para baixo`}
        disabled={!canMoveDown || busy}
        onClick={() => onMove("down")}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          arrow_downward
        </span>
      </button>
    </span>
  );
}
