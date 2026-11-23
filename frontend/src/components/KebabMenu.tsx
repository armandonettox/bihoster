import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export default function KebabMenu({
  children,
  onClose,
  floating = false,
}: {
  children: (close: () => void) => ReactNode;
  /** Abre a janela solta da tela (posicao fixa) em vez de presa ao botao: para listas dentro de area com rolagem, onde
   * a janela seria cortada nas ultimas linhas. Fecha ao rolar ou redimensionar. */
  floating?: boolean;
  /** Chamado sempre que o menu fecha, inclusive por clique fora -- use pra resetar
   * estado de confirmacao de exclusao guardado no componente pai. */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [floatStyle, setFloatStyle] = useState<CSSProperties | undefined>(undefined);

  function close() {
    setOpen(false);
    onClose?.();
  }

  function toggle() {
    if (open) return close();
    if (floating && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Perto do rodape, abre para cima para a janela caber
      const opensUp = window.innerHeight - rect.bottom < 200 && rect.top > 200;
      setFloatStyle({
        position: "fixed",
        right: window.innerWidth - rect.right,
        ...(opensUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    // So registra os listeners globais enquanto o menu esta aberto -- com um KebabMenu por
    // linha de lista (relatorios, membros, grupos), deixa-los sempre ativos significa dezenas
    // de listeners de mousedown/keydown rodando em toda a pagina mesmo com tudo fechado.
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    if (floating) {
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="kebab-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        ref={triggerRef}
        className="kebab-menu-trigger"
        onClick={toggle}
        title="Mais opcoes"
        aria-label="Mais opcoes"
        aria-haspopup="true"
        aria-expanded={open}
      >
        &#8942;
      </button>
      {open && (
        <div className="kebab-menu-dropdown" style={floating ? floatStyle : undefined}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
