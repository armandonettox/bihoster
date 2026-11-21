import { useEffect, useRef, useState } from "react";
import * as templatesApi from "../api/emailTemplates";
import type { EmailTemplate } from "../api/emailTemplates";
import { extractErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Modal from "./Modal";

const PREVIEW_DELAY_MS = 350;

type Field = "subject" | "body" | "button";

/** Editar um e-mail que o sistema envia: assunto, mensagem e texto do botão, com a prévia em HTML ao lado (segue o que
 * está digitado, sem salvar) e o envio de um teste. Os campos já vêm com o texto que vale hoje, para editar em vez de
 * escrever do zero; texto igual ao padrão é gravado como "padrão", e não como personalizado. */
export default function EmailTemplateModal({
  template,
  canSendTest,
  onSaved,
  onClose,
}: {
  template: EmailTemplate;
  /** Só dá para mandar o teste com o servidor de e-mail configurado */
  canSendTest: boolean;
  onSaved: (saved: EmailTemplate) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const initial = {
    subject: template.subject ?? template.default_subject,
    body: template.body ?? template.default_body,
    button: template.button ?? template.default_button ?? "",
  };
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [button, setButton] = useState(initial.button);

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refs = {
    subject: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null),
    button: useRef<HTMLInputElement>(null),
  };
  const lastField = useRef<Field>("body");

  /** O que mandar ao servidor: o que for igual ao padrão vai como nulo (vale o padrão) */
  function draft() {
    const asDraft = (value: string, fallback: string | null) => {
      const text = value.trim();
      return text === "" || text === (fallback ?? "") ? null : text;
    };
    return {
      subject: asDraft(subject, template.default_subject),
      body: asDraft(body, template.default_body),
      ...(template.has_button ? { button: asDraft(button, template.default_button) } : {}),
    };
  }

  // A prévia acompanha o que esta digitado, com uma pequena espera para nao pedir a cada tecla
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      templatesApi
        .previewEmailTemplate(template.key, draft())
        .then((result) => {
          if (cancelled) return;
          setPreviewHtml(result.html);
          setPreviewSubject(result.subject);
          setPreviewError(null);
        })
        .catch((err) => {
          if (!cancelled) setPreviewError(extractErrorMessage(err) || "Não foi possível montar a prévia.");
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // draft() depende so destes tres textos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, button, template.key]);

  const dirty = subject !== initial.subject || body !== initial.body || button !== initial.button;

  function insertVariable(name: string) {
    const field = template.has_button || lastField.current !== "button" ? lastField.current : "body";
    const input = refs[field].current;
    const token = `{${name}}`;
    const current = field === "subject" ? subject : field === "body" ? body : button;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    if (field === "subject") setSubject(next);
    else if (field === "body") setBody(next);
    else setButton(next);
    // Devolve o cursor para depois da variavel inserida
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await templatesApi.saveEmailTemplate(template.key, draft());
      onSaved(saved);
      showToast("E-mail salvo.");
      onClose();
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Não foi possível salvar o e-mail.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await templatesApi.resetEmailTemplate(template.key);
      onSaved(saved);
      showToast("E-mail restaurado ao texto padrão.");
      onClose();
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Não foi possível restaurar o e-mail.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      await templatesApi.sendEmailTemplateTest(template.key, testTo.trim(), draft());
      setTestResult({ ok: true, text: `Teste enviado para ${testTo.trim()}. Confira a caixa de entrada.` });
    } catch (err: any) {
      setTestResult({ ok: false, text: extractErrorMessage(err) || "Não foi possível enviar o teste." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal title={template.label} onClose={onClose} wide>
      <p className="settings-section-desc">{template.description}</p>

      <div className="email-editor">
        <div className="email-editor-form">
          <label className="field">
            Assunto
            <input
              ref={refs.subject}
              className="input"
              value={subject}
              maxLength={150}
              onFocus={() => (lastField.current = "subject")}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>

          <label className="field">
            Mensagem
            <textarea
              ref={refs.body}
              className="input"
              rows={10}
              value={body}
              maxLength={3000}
              onFocus={() => (lastField.current = "body")}
              onChange={(e) => setBody(e.target.value)}
              style={{ resize: "vertical" }}
            />
            <span className="field-hint">Uma linha em branco separa um parágrafo do outro.</span>
          </label>

          {template.has_button && (
            <label className="field">
              Texto do botão
              <input
                ref={refs.button}
                className="input"
                value={button}
                maxLength={40}
                onFocus={() => (lastField.current = "button")}
                onChange={(e) => setButton(e.target.value)}
              />
            </label>
          )}

          <div className="email-variables">
            <span className="field-hint">Dados que entram no texto (clique para inserir no campo em que você está):</span>
            <div className="email-variable-chips">
              {template.variables.map((variable) => (
                <button
                  key={variable.name}
                  type="button"
                  className="email-variable-chip"
                  title={variable.label}
                  onClick={() => insertVariable(variable.name)}
                >
                  {`{${variable.name}}`}
                </button>
              ))}
            </div>
            <span className="field-hint">Uma linha que usa um dado vazio é omitida do e-mail.</span>
          </div>
        </div>

        <div className="email-editor-preview">
          <h3 className="brand-preview-title">Prévia</h3>
          {previewSubject && (
            <p className="email-preview-subject">
              <span className="field-hint">Assunto:</span> {previewSubject}
            </p>
          )}
          {previewError && (
            <p className="auth-error" role="alert">
              {previewError}
            </p>
          )}
          {previewHtml !== null ? (
            // Sem scripts nem nada da pagina: o HTML da previa e so para olhar
            <iframe title="Prévia do e-mail" className="email-preview-frame" sandbox="" srcDoc={previewHtml} />
          ) : (
            !previewError && <p className="field-hint">Montando a prévia...</p>
          )}
          <p className="field-hint brand-preview-note">Usa o nome, a cor e o logo da marca, com dados de exemplo.</p>

          <div className="email-test">
            <label className="field" style={{ margin: 0 }}>
              Enviar um teste para
              <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={testing || !canSendTest || !testTo.trim()}
              onClick={handleTest}
            >
              {testing ? "Enviando..." : "Enviar teste"}
            </button>
          </div>
          {!canSendTest && <p className="field-hint">Salve o servidor de e-mail para poder enviar o teste.</p>}
          {testResult && (
            <p role="status" className={testResult.ok ? "field-hint" : "auth-error"}>
              {testResult.text}
            </p>
          )}
        </div>
      </div>

      {saveError && (
        <p className="auth-error" role="alert">
          {saveError}
        </p>
      )}
      <div className="modal-actions-sticky">
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
        {template.customized && (
          <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={saving} style={{ marginLeft: "auto" }}>
            Restaurar o texto padrão
          </button>
        )}
      </div>
    </Modal>
  );
}
