import { useState } from "react";
import { revertAuditAction, revertConflictOf, type AuditLogEntry, type RevertConflict } from "../../api/audit";
import { extractErrorMessage } from "../../api/client";
import Modal from "../Modal";

interface Props {
  entry: AuditLogEntry;
  /** Reversao concluida: recebe a frase do que foi revertido */
  onReverted: (summary: string) => void;
  onClose: () => void;
}

/** Confirmacao de reversao. Se o item mudou de novo depois da acao, mostra o que esta valendo
 * agora e so segue com a confirmacao seguinte ("Reverter mesmo assim"). */
export default function RevertDialog({ entry, onReverted, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<RevertConflict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await revertAuditAction(entry.id, force);
      onReverted(result.summary);
    } catch (err: unknown) {
      const warning = revertConflictOf(err);
      if (warning) setConflict(warning);
      else setError(extractErrorMessage(err) || "Nao foi possivel reverter esta acao.");
    } finally {
      setBusy(false);
    }
  }

  // O item sumiu depois da acao: nao ha como reverter, so fechar
  if (conflict?.code === "gone") {
    return (
      <Modal title="Nao ha o que reverter" onClose={onClose}>
        <p className="dialog-message">{conflict.message}</p>
        <div className="flex-row gap-sm">
          <button className="btn btn-ghost" onClick={onClose}>
            Entendi
          </button>
        </div>
      </Modal>
    );
  }

  if (conflict) {
    return (
      <Modal title="Este item mudou depois dessa acao" onClose={onClose}>
        <p className="dialog-message">
          {conflict.message} Reverter agora desfaz tambem a mudanca mais recente.
        </p>
        <dl className="revert-states">
          <div>
            <dt>Logo depois da acao</dt>
            <dd>{conflict.expected}</dd>
          </div>
          <div>
            <dt>Agora</dt>
            <dd>{conflict.current}</dd>
          </div>
          <div>
            <dt>Depois de reverter</dt>
            <dd>{conflict.after_revert}</dd>
          </div>
        </dl>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="flex-row gap-sm">
          <button className="btn btn-danger" disabled={busy} onClick={() => run(true)}>
            {busy ? "Revertendo..." : "Reverter mesmo assim"}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Reverter esta acao?" onClose={onClose}>
      <p className="dialog-message">{entry.revert_summary}</p>
      <p className="revert-note">A reversao tambem fica registrada na auditoria.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="flex-row gap-sm">
        <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}>
          {busy ? "Revertendo..." : "Reverter"}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
