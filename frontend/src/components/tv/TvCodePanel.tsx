import { useCallback, useEffect, useState } from "react";
import { extractErrorMessage } from "../../api/client";
import { getTvCode, type TvCode } from "../../api/tvs";

/** O codigo de acesso da TV, que muda com o tempo (como a dupla autenticacao): mostra os 6 digitos, uma barra com o
 * tempo que falta e busca o codigo novo sozinho quando o atual vence. */
export default function TvCodePanel({ tvId }: { tvId: number }) {
  const [code, setCode] = useState<TvCode | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getTvCode(tvId);
      setCode(next);
      setLeft(next.expires_in_seconds);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel buscar o codigo.");
    }
  }, [tvId]);

  useEffect(() => {
    load();
  }, [load]);

  // Conta os segundos e, quando acaba, pede o codigo seguinte
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => {
      setLeft((current) => {
        if (current <= 1) {
          load();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [code, load]);

  if (error) return <p className="auth-error">{error}</p>;
  if (!code) return <p className="tv-muted">Buscando o codigo...</p>;

  const digits = code.code.replace(/(\d{3})(\d{3})/, "$1 $2");
  const percent = Math.max(0, Math.min(100, (left / code.step_seconds) * 100));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <div className="tv-code" aria-live="off">
      <span className="tv-code-digits" aria-label={`Codigo de acesso ${code.code.split("").join(" ")}`}>
        {digits}
      </span>
      <span className="tv-code-bar" aria-hidden="true">
        <span className="tv-code-bar-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="tv-muted">
        Muda em {minutes}:{seconds}
      </span>
    </div>
  );
}
