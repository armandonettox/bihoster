import { useState } from "react";
import * as emailApi from "../../../api/emailSettings";
import type { EmailSettings, SmtpSecurity } from "../../../api/emailSettings";
import { extractErrorMessage } from "../../../api/client";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useToast } from "../../../context/ToastContext";

// Porta comum de cada tipo de seguranca: sugerida ao trocar o tipo, se a porta ainda for a do tipo anterior
const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, ssl: 465, none: 25 };

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  starttls: "STARTTLS (porta 587, o mais comum)",
  ssl: "SSL/TLS (porta 465)",
  none: "Nenhuma (só em rede interna, sem usuário e senha)",
};

/** O servidor de e-mail (SMTP): endereço, porta, segurança, login, remetente e os domínios que podem receber. A senha
 * nunca volta do servidor: em branco mantém a atual, "apagar" a remove e um texto novo a troca. */
export default function EmailServerModal({
  settings,
  onSaved,
  onClose,
}: {
  settings: EmailSettings;
  onSaved: (saved: EmailSettings) => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();

  const saved = {
    host: settings.smtp_host ?? "",
    port: String(settings.smtp_port ?? DEFAULT_PORTS[settings.smtp_security ?? "starttls"]),
    security: (settings.smtp_security ?? "starttls") as SmtpSecurity,
    username: settings.smtp_username ?? "",
    fromEmail: settings.smtp_from_email ?? "",
    fromName: settings.smtp_from_name ?? "",
    domains: settings.email_allowed_domains ?? "",
  };
  const [host, setHost] = useState(saved.host);
  const [port, setPort] = useState(saved.port);
  const [security, setSecurity] = useState<SmtpSecurity>(saved.security);
  const [username, setUsername] = useState(saved.username);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromEmail, setFromEmail] = useState(saved.fromEmail);
  const [fromName, setFromName] = useState(saved.fromName);
  const [domains, setDomains] = useState(saved.domains);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    host !== saved.host ||
    port !== saved.port ||
    security !== saved.security ||
    username !== saved.username ||
    fromEmail !== saved.fromEmail ||
    fromName !== saved.fromName ||
    domains !== saved.domains ||
    password !== "" ||
    clearPassword;

  const passwordConfigured = settings.smtp_password_configured && !clearPassword;

  function changeSecurity(next: SmtpSecurity) {
    // So troca a porta se ela ainda for a sugerida pro tipo anterior: nao apaga uma porta digitada
    if (Number(port) === DEFAULT_PORTS[security]) setPort(String(DEFAULT_PORTS[next]));
    setSecurity(next);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const result = await emailApi.updateEmailSettings({
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
      onSaved(result);
      showToast("Configurações de e-mail salvas.");
      onClose();
    } catch (err: any) {
      setError(extractErrorMessage(err) || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Servidor de e-mail (SMTP)"
      description="Usado para enviar relatórios e os avisos do sistema por e-mail. Os dados ficam só no servidor: a senha é guardada cifrada e nunca é exibida depois de salva."
      dirty={dirty}
      saving={saving}
      error={error}
      wide
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <div className="settings-grid">
        <label className="field">
          Servidor
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.empresa.com" />
        </label>
        <label className="field">
          Porta
          <input className="input" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
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
          {settings.smtp_password_configured && (
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
        <input className="input" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="empresa.com, empresa.com.br" />
        <span style={{ fontWeight: 400, fontSize: 12 }}>
          Opcional, e recomendado: lista separada por vírgula. Com ela, nenhum relatório sai para um endereço fora desses
          domínios. Em branco, qualquer endereço é aceito.
        </span>
      </label>
    </SettingsEditModal>
  );
}
