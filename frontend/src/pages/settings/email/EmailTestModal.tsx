import { useState } from "react";
import * as emailApi from "../../../api/emailSettings";
import { extractErrorMessage } from "../../../api/client";
import Modal from "../../../components/Modal";
import { useAuth } from "../../../context/AuthContext";

/** Manda um e-mail de teste para conferir se o servidor funciona. Começa com o endereço de quem está logado. */
export default function EmailTestModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleTest() {
    setResult(null);
    setTesting(true);
    try {
      await emailApi.sendTestEmail(testTo.trim());
      setResult({ ok: true, text: `E-mail de teste enviado para ${testTo.trim()}. Confira a caixa de entrada.` });
    } catch (err: any) {
      setResult({ ok: false, text: extractErrorMessage(err) || "Não foi possível enviar o e-mail de teste." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal title="Enviar e-mail de teste" onClose={onClose}>
      <p className="settings-section-desc">Confira se o servidor está funcionando mandando um e-mail para você.</p>
      <label className="field">
        Enviar para
        <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
      </label>
      {result && (
        <p
          role="status"
          className={result.ok ? undefined : "auth-error"}
          style={result.ok ? { color: "var(--color-text-muted)" } : undefined}
        >
          {result.text}
        </p>
      )}
      <div className="modal-actions-sticky">
        <button type="button" className="btn btn-primary btn-sm" disabled={testing || !testTo.trim()} onClick={() => void handleTest()}>
          {testing ? "Enviando..." : "Enviar teste"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
