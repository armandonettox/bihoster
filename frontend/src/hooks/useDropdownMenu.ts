import { useEffect, useRef, useState } from "react";

/** Estado de um menu suspenso da barra do topo: fecha ao clicar fora e com Esc (devolvendo o foco ao botao). */
export function useDropdownMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // So registra os listeners globais enquanto o menu esta aberto -- sem isso, ficam ativos
    // (e rodando a cada clique/tecla na pagina inteira) durante toda a vida do componente.
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, containerRef, triggerRef };
}
