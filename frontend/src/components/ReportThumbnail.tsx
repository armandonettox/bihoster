import { useEffect, useRef, useState } from "react";
import ReportEmbed from "./ReportEmbed";

// Tamanho de referencia -- a maioria dos relatorios do Power BI e desenhada nessa proporcao
// (16:9). Renderizamos o embed nesse tamanho "real" e encolhemos com CSS scale ate caber no
// card, em vez de deixar o relatorio no tamanho normal dentro de uma caixa pequena (o que so
// mostra um pedaco cortado do canto superior esquerdo).
const NATIVE_WIDTH = 1280;
const NATIVE_HEIGHT = 720;

export default function ReportThumbnail({ reportId }: { reportId: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // Largura 0 acontece quando o card fica oculto (aba escondida, display:none) --
      // desmonta o embed em vez de manter a sessao do Power BI viva e invisivel com o
      // ultimo scale calculado.
      setScale(width / NATIVE_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      {scale > 0 && (
        <div
          style={{
            width: NATIVE_WIDTH,
            height: NATIVE_HEIGHT,
            overflow: "hidden",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <ReportEmbed reportId={reportId} height={NATIVE_HEIGHT} />
        </div>
      )}
    </div>
  );
}
