import { useEffect, useRef, useState, type ReactNode } from "react";

export default function KebabMenu({
  children,
  onClose,
}: {
  children: (close: () => void) => ReactNode;
  /** Chamado sempre que o menu fecha, inclusive por clique fora -- use pra resetar
   * estado de confirmacao de exclusao guardado no componente pai. */
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    onClose?.();
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
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="kebab-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="kebab-menu-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        title="Mais opcoes"
        aria-label="Mais opcoes"
        aria-haspopup="true"
        aria-expanded={open}
      >
        &#8942;
      </button>
      {open && <div className="kebab-menu-dropdown">{children(close)}</div>}
    </div>
  );
}
