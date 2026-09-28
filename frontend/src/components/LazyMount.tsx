import { useEffect, useRef, useState, type ReactNode } from "react";

/** So renderiza `children` quando o elemento entra na tela -- usado pra nao disparar
 * varios embeds ao vivo do Power BI de uma vez quando a colecao tem muitos relatorios. */
export default function LazyMount({ children, placeholder }: { children: ReactNode; placeholder?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={{ height: "100%", width: "100%" }}>
      {visible ? children : placeholder}
    </div>
  );
}
