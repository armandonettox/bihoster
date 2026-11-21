import type { FormEvent, ReactNode } from "react";
import Modal from "./Modal";

/** A janela de edição de uma parte da Administração: os campos, o erro de gravação (se houver) e os botões Salvar e
 * Cancelar. Enter num campo salva. O Salvar só liga quando algo mudou. */
export default function SettingsEditModal({
  title,
  description,
  dirty,
  saving,
  error,
  canSave = true,
  wide = false,
  onSave,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  /** Mudou algo em relação ao que está salvo? */
  dirty: boolean;
  saving: boolean;
  /** Erro da última gravação, mostrado dentro da janela */
  error: string | null;
  /** Falso quando há um campo inválido (desliga o Salvar mesmo com mudança) */
  canSave?: boolean;
  wide?: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (dirty && canSave && !saving) onSave();
  }

  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      {description && <p className="settings-section-desc">{description}</p>}
      <form onSubmit={handleSubmit}>{children}</form>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions-sticky">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving || !dirty || !canSave}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
