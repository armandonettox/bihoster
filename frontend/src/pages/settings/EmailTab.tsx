import { useEffect, useState, type FormEvent } from "react";
import * as emailApi from "../../api/emailSettings";
import type { EmailSettings, SmtpSecurity } from "../../api/emailSettings";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { SkeletonList } from "../../components/Skeleton";

// Porta comum de cada tipo de seguranca: sugerida ao trocar o tipo, se a porta ainda for a do tipo anterior
const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, ssl: 465, none: 25 };

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  starttls: "STARTTLS (porta 587, o mais comum)",
  ssl: "SSL/TLS (porta 465)",
  none: "Nenhuma (so em rede interna, sem usuario e senha)",
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
      showToast("Configuracoes de e-mail salvas.");
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar.");
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
      setTestResult({ ok: false, text: extractErrorMessage(err) || "Nao foi possivel enviar o e-mail de teste." });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) return <p className="auth-error">Nao foi possivel carregar as configuracoes de e-mail.</p>;
  if (!loaded) return <SkeletonList count={3} />;

  const passwordConfigured = loaded.smtp_password_configured && !clearPassword;

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Servidor de e-mail (SMTP)</h2>
        <p className="settings-section-desc">
          Usado para enviar relatorios por e-mail. Os dados ficam so no servidor: a senha e guardada cifrada e nunca e
          exibida depois de salva.
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
              Seguranca
              <select className="input" value={security} onChange={(e) => changeSecurity(e.target.value as SmtpSecurity)}>
                {(Object.keys(SECURITY_LABELS) as SmtpSecurity[]).map((key) => (
                  <option key={key} value={key}>
                    {SECURITY_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Usuario
              <input
                className="input"
                value={username}
                autoComplete="off"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Deixe em branco se o servidor nao exige login"
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
                  placeholder={passwordConfigured ? "Ja configurada -- deixe em branco para manter" : ""}
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
              <span style={{ fontWeight: 400, fontSize: 12 }}>O endereco que aparece como remetente.</span>
            </label>
            <label className="field">
              Nome do remetente
              <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="BIHoster" />
            </label>
          </div>

          <label className="field" style={{ marginTop: 16 }}>
            Dominios que podem receber e-mail
            <input
              className="input"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="empresa.com, empresa.com.br"
            />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              Opcional, e recomendado: lista separada por virgula. Com ela, nenhum relatorio sai para um endereco fora
              desses dominios. Em branco, qualquer endereco e aceito.
            </span>
          </label>

          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Enviar e-mail de teste</h2>
        <p className="settings-section-desc">
          {loaded.configured
            ? "Confira se o servidor esta funcionando mandando um e-mail para voce."
            : "Salve o servidor e o e-mail de origem para poder testar."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="field" style={{ flex: "1 1 280px", margin: 0 }}>
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
        </div>
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
  );
}
