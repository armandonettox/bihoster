import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Guarda a versao mais recente de onClose sem entrar nas deps do effect abaixo -- callers
  // que declaram `onClose={() => ...}` inline (comum) recriam essa funcao a cada render do
  // proprio componente pai, inclusive a cada tecla digitada num campo controlado por ele. Se
  // onClose estivesse nas deps, o effect re-executava a cada letra digitada e a linha de foco
  // inicial (abaixo) roubava o foco de volta do campo, tornando impossivel digitar.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panelRef.current)?.focus();

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      // O elemento que abriu o modal pode ja ter sido desmontado nesse meio-tempo (ex: um
      // KebabMenu que fecha o proprio dropdown antes do modal terminar de fechar) -- focar um
      // elemento fora do DOM e um no-op silencioso que deixa o foco perdido.
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Deliberadamente so no mount/unmount -- ver comentario do onCloseRef acima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay modal-overlay-enter" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel modal-panel-enter"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-body"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="modal-title">
            {title}
          </h2>
          <button className="modal-close" onClick={onClose} title="Fechar" aria-label="Fechar">
            &times;
          </button>
        </div>
        <div className="modal-body" id="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}
