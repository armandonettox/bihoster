import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Imagem ou GIF do histórico de versões: aparece pequena e sempre à esquerda, num tamanho único para todas, e abre
 * ampliada numa janela ao clicar (com opção de abrir em outra aba). Esc, clique fora ou Fechar voltam à lista. */
export default function ChangelogImage({ url, alt }: { url: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="changelog-image-link"
        onClick={() => setOpen(true)}
        title="Clique para ampliar"
        aria-label={alt ? `Ampliar imagem: ${alt}` : "Ampliar imagem"}
      >
        <img className="changelog-image" src={url} alt={alt} loading="lazy" />
        <span className="material-symbols-outlined changelog-image-zoom" aria-hidden="true">
          zoom_in
        </span>
      </button>
      {open &&
        createPortal(
          <div className="changelog-lightbox" role="dialog" aria-modal="true" aria-label={alt || "Imagem ampliada"} onClick={() => setOpen(false)}>
            <div className="changelog-lightbox-bar" onClick={(event) => event.stopPropagation()}>
              <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                Abrir em outra aba
              </a>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                Fechar
              </button>
            </div>
            <img className="changelog-lightbox-image" src={url} alt={alt} onClick={(event) => event.stopPropagation()} />
            {alt && <p className="changelog-lightbox-caption">{alt}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
