import { useEffect, useRef, useState, type ReactNode } from "react";

// Com `unmountWhenHidden`, o conteudo so monta depois de ficar visivel um instante (uma rolagem rapida
// nao monta o que so passou pela tela) e so desmonta depois de ficar fora da tela por um tempo
// (rolar um pouco pra cima e pra baixo nao recarrega tudo).
const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 2000;

/** So renderiza `children` quando o elemento entra na tela -- usado pra nao disparar varios embeds ao
 * vivo do Power BI de uma vez quando a colecao tem muitos relatorios.
 *
 * Por padrao, depois de montado o conteudo fica montado. Com `unmountWhenHidden`, ele e desmontado
 * quando sai da tela: cada embed vivo roda consultas e desenha visuais, e acumular dezenas deles
 * trava o navegador, inclusive o relatorio que a pessoa esta usando. */
export default function LazyMount({
  children,
  placeholder,
  unmountWhenHidden = false,
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  unmountWhenHidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Comportamento padrao: monta na primeira vez que aparece e nunca mais desmonta
  useEffect(() => {
    if (unmountWhenHidden || visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible, unmountWhenHidden]);

  // Com unmountWhenHidden: acompanha entrada e saida da tela, com atraso nas duas direcoes
  useEffect(() => {
    if (!unmountWhenHidden || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries[entries.length - 1]?.isIntersecting ?? false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setVisible(intersecting), intersecting ? SHOW_DELAY_MS : HIDE_DELAY_MS);
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [unmountWhenHidden]);

  return (
    <div ref={ref} style={{ height: "100%", width: "100%" }}>
      {visible ? children : placeholder}
    </div>
  );
}
