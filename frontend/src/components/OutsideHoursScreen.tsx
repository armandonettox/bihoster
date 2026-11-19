import { formatNextOpen } from "../utils/outsideHours";
import type { OutsideHoursInfo } from "../utils/outsideHours";

interface Props {
  info: OutsideHoursInfo;
  retrying?: boolean;
  onRetry: () => void;
  onLeave: () => void;
}

/** Tela inteira para quem está fora do horário de acesso: mostra o horário permitido e quando o acesso volta. Não usa
 * nada do app (menu, contextos), porque o servidor recusa qualquer pedido nesse momento. */
export default function OutsideHoursScreen({ info, retrying = false, onRetry, onLeave }: Props) {
  const nextOpen = formatNextOpen(info);
  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert">
        <h1 className="auth-title">Fora do horário de acesso</h1>
        <p className="auth-subtitle">
          {nextOpen ? `O seu acesso volta em ${nextOpen}.` : "Você não pode usar o sistema neste momento."}
        </p>

        {info.windows.length > 0 && (
          <div className="field">
            <span>Seu horário de acesso</span>
            <ul className="outside-hours-windows">
              {info.windows.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {info.timezone && <span className="field-hint">Horário de {info.timezone}.</span>}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onRetry} disabled={retrying}>
            {retrying ? "Verificando..." : "Tentar novamente"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
