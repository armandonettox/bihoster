import { useEffect, useState, type FormEvent } from "react";
import * as emailApi from "../../api/emailSettings";
import type { EmailSettings, SmtpSecurity } from "../../api/emailSettings";
import * as templatesApi from "../../api/emailTemplates";
import type { EmailTemplate } from "../../api/emailTemplates";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import EmailTemplateModal from "../../components/EmailTemplateModal";
import { SkeletonList } from "../../components/Skeleton";

// Porta comum de cada tipo de seguranca: sugerida ao trocar o tipo, se a porta ainda for a do tipo anterior
const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, ssl: 465, none: 25 };

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  starttls: "STARTTLS (porta 587, o mais comum)",
  ssl: "SSL/TLS (porta 465)",
  none: "Nenhuma (só em rede interna, sem usuário e senha)",
};

export default function EmailTab() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [loaded, setLoaded] = useState<EmailSettings | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [security, setSecurity] = useState<SmtpSecurity>("starttls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState(user?.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Os e-mails que o sistema envia, com o texto de cada um; abrir um deles abre o editor
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);

  function fill(data: EmailSettings) {
    setLoaded(data);
    setHost(data.smtp_host ?? "");
    setPort(String(data.smtp_port ?? DEFAULT_PORTS[data.smtp_security ?? "starttls"]));
    setSecurity(data.smtp_security ?? "starttls");
    setUsername(data.smtp_username ?? "");
    setPassword("");
    setClearPassword(false);
    setFromEmail(data.smtp_from_email ?? "");
    setFromName(data.smtp_from_name ?? "");
    setDomains(data.email_allowed_domains ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    emailApi
      .getEmailSettings()
      .then((data) => {
        if (!cancelled) fill(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    templatesApi
      .listEmailTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        if (!cancelled) setTemplatesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function changeSecurity(next: SmtpSecurity) {
    // So troca a porta se ela ainda for a sugerida pro tipo anterior: nao apaga uma porta digitada
    if (Number(port) === DEFAULT_PORTS[security]) setPort(String(DEFAULT_PORTS[next]));
    setSecurity(next);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await emailApi.updateEmailSettings({
        smtp_host: host.trim() || null,
        smtp_port: Number(port) || null,
        smtp_security: security,
        smtp_username: username.trim() || null,
        smtp_from_email: fromEmail.trim() || null,
        smtp_from_name: fromName.trim() || null,
        email_allowed_domains: domains.trim() || null,
        // Sem digitar nada a senha atual e mantida; "apagar" manda texto vazio
        ...(clearPassword ? { smtp_password: "" } : password ? { smtp_password: password } : {}),
      });
      fill(saved);
      showToast("Configurações de e-mail salvas.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      await emailApi.sendTestEmail(testTo.trim());
      setTestResult({ ok: true, text: `E-mail de teste enviado para ${testTo.trim()}. Confira a caixa de entrada.` });
    } catch (err: any) {
      setTestResult({ ok: false, text: extractErrorMessage(err) || "Não foi possível enviar o e-mail de teste." });
    } finally {
      setTesting(false);
    }
  }

  function handleTemplateSaved(saved: EmailTemplate) {
    setTemplates((current) => (current ? current.map((item) => (item.key === saved.key ? saved : item)) : current));
  }

  if (loadError) return <p className="auth-error">Não foi possível carregar as configurações de e-mail.</p>;
  if (!loaded) return <SkeletonList count={3} />;

  const passwordConfigured = loaded.smtp_password_configured && !clearPassword;

  return (
    <div className="brand-layout">
      {/* Cartão 1: o servidor à esquerda e, no mesmo cartão, o teste de envio */}
      <div className="settings-section brand-card">
        <div className="brand-card-main">
          <h2 className="settings-section-title">Servidor de e-mail (SMTP)</h2>
          <p className="settings-section-desc">
            Usado para enviar relatórios e os avisos do sistema por e-mail. Os dados ficam só no servidor: a senha é
            guardada cifrada e nunca é exibida depois de salva.
          </p>

          <form onSubmit={handleSave}>
            <div className="settings-grid">
              <label className="field">
                Servidor
                <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.empresa.com" />
              </label>
              <label className="field">
                Porta
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
              <label className="field">
                Segurança
                <select className="input" value={security} onChange={(e) => changeSecurity(e.target.value as SmtpSecurity)}>
                  {(Object.keys(SECURITY_LABELS) as SmtpSecurity[]).map((key) => (
                    <option key={key} value={key}>
                      {SECURITY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Usuário
                <input
                  className="input"
                  value={username}
                  autoComplete="off"
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Deixe em branco se o servidor não exige login"
                />
              </label>
              <div>
                <label className="field">
                  Senha
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    disabled={clearPassword}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={passwordConfigured ? "Já configurada: deixe em branco para manter" : ""}
                  />
                </label>
                {loaded.smtp_password_configured && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={clearPassword}
                      onChange={(e) => {
                        setClearPassword(e.target.checked);
                        if (e.target.checked) setPassword("");
                      }}
                    />
                    Apagar a senha salva
                  </label>
                )}
              </div>
            </div>

            <div className="settings-grid" style={{ marginTop: 16 }}>
              <label className="field">
                E-mail de origem
                <input
                  className="input"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="relatorios@empresa.com"
                />
                <span style={{ fontWeight: 400, fontSize: 12 }}>O endereço que aparece como remetente.</span>
              </label>
              <label className="field">
                Nome do remetente
                <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="BIHoster" />
              </label>
            </div>

            <label className="field" style={{ marginTop: 16 }}>
              Domínios que podem receber e-mail
              <input
                className="input"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="empresa.com, empresa.com.br"
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Opcional, e recomendado: lista separada por vírgula. Com ela, nenhum relatório sai para um endereço fora
                desses domínios. Em branco, qualquer endereço é aceito.
              </span>
            </label>

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </form>
        </div>

        <div className="brand-card-preview">
          <h3 className="brand-preview-title">Enviar e-mail de teste</h3>
          <p className="settings-section-desc">
            {loaded.configured
              ? "Confira se o servidor está funcionando mandando um e-mail para você."
              : "Salve o servidor e o e-mail de origem para poder testar."}
          </p>
          <label className="field" style={{ margin: "0 0 10px" }}>
            Enviar para
            <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={testing || !loaded.configured || !testTo.trim()}
            onClick={handleTest}
          >
            {testing ? "Enviando..." : "Enviar teste"}
          </button>
          {testResult && (
            <p
              role="status"
              className={testResult.ok ? undefined : "auth-error"}
              style={testResult.ok ? { color: "var(--color-text-muted)", marginTop: 12 } : { marginTop: 12 }}
            >
              {testResult.text}
            </p>
          )}
        </div>
      </div>

      {/* Cartão 2: os e-mails que o sistema envia, para ver e ajustar o texto de cada um */}
      <div className="settings-section">
        <h2 className="settings-section-title">E-mails enviados pelo sistema</h2>
        <p className="settings-section-desc">
          Os avisos de convite, redefinição de senha e horário de acesso saem em HTML, com o nome, a cor e o logo da marca.
          Abra um deles para ajustar o assunto e o texto, ver a prévia e mandar um teste.
        </p>

        {templatesError && <p className="auth-error">Não foi possível carregar os e-mails.</p>}
        {!templatesError && templates === null && <SkeletonList count={3} />}
        {templates && (
          <ul className="email-template-list">
            {templates.map((template) => (
              <li key={template.key} className="email-template-row">
                <div className="email-template-text">
                  <span className="email-template-name">{template.label}</span>
                  <span className="field-hint">{template.description}</span>
                </div>
                <span className={template.customized ? "email-template-badge email-template-badge-custom" : "email-template-badge"}>
                  {template.customized ? "Personalizado" : "Padrão"}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(template)}>
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EmailTemplateModal
          template={editing}
          canSendTest={loaded.configured}
          onSaved={handleTemplateSaved}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
