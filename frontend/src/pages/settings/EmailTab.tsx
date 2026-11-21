import { useEffect, useState } from "react";
import * as emailApi from "../../api/emailSettings";
import type { EmailSettings } from "../../api/emailSettings";
import * as templatesApi from "../../api/emailTemplates";
import type { EmailTemplate } from "../../api/emailTemplates";
import EmailTemplateModal from "../../components/EmailTemplateModal";
import SettingsRowList, { type SettingsRow } from "../../components/SettingsRowList";
import { SkeletonList } from "../../components/Skeleton";
import EmailLogoModal from "./email/EmailLogoModal";
import EmailServerModal from "./email/EmailServerModal";
import EmailTestModal from "./email/EmailTestModal";

type Editing = "server" | "test" | "logo" | null;

export default function EmailTab() {
  const [loaded, setLoaded] = useState<EmailSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  // Os e-mails que o sistema envia, com o texto de cada um; abrir um deles abre o editor
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);

  useEffect(() => {
    let cancelled = false;
    emailApi
      .getEmailSettings()
      .then((data) => {
        if (!cancelled) setLoaded(data);
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

  function handleTemplateSaved(saved: EmailTemplate) {
    setTemplates((current) => (current ? current.map((item) => (item.key === saved.key ? saved : item)) : current));
  }

  if (loadError) return <p className="auth-error">Não foi possível carregar as configurações de e-mail.</p>;
  if (!loaded) return <SkeletonList count={3} />;

  const close = () => setEditing(null);
  const hasOwnLogo = Boolean(loaded.email_logo_url);

  const rows: SettingsRow[] = [
    {
      key: "server",
      label: "Servidor de e-mail (SMTP)",
      description: "O servidor que envia os relatórios e os avisos do sistema, o remetente e os domínios que podem receber.",
      summary: loaded.configured
        ? `${loaded.smtp_host}:${loaded.smtp_port} · de ${loaded.smtp_from_email}`
        : "Informe o servidor e o e-mail de origem para poder enviar.",
      status: loaded.configured ? "Configurado" : "Não configurado",
      highlight: loaded.configured,
      onEdit: () => setEditing("server"),
    },
    {
      key: "test",
      label: "E-mail de teste",
      description: "Manda um e-mail para você conferir se o servidor está funcionando.",
      summary: loaded.configured ? undefined : "Salve o servidor e o e-mail de origem para poder testar.",
      actionLabel: "Enviar",
      ariaLabel: "Enviar e-mail de teste",
      onEdit: () => setEditing("test"),
      disabled: !loaded.configured,
    },
    {
      key: "logo",
      label: "Logo dos e-mails",
      description: "O logo do topo de todos os e-mails. Sem um logo próprio, usa o da marca.",
      status: hasOwnLogo ? "Personalizado" : "Padrão",
      highlight: hasOwnLogo,
      onEdit: () => setEditing("logo"),
    },
  ];

  return (
    <div className="brand-layout">
      {/* Bloco 1: o servidor, o teste de envio e o logo, cada um numa janela */}
      <div className="settings-section">
        <h2 className="settings-section-title">Servidor e envio</h2>
        <p className="settings-section-desc">
          O servidor usado para enviar relatórios e os avisos do sistema por e-mail. Abra uma parte para ajustar e salvar.
        </p>
        <SettingsRowList rows={rows} />
      </div>

      {/* Bloco 2: os e-mails que o sistema envia, para ver e ajustar o texto de cada um */}
      <div className="settings-section">
        <h2 className="settings-section-title">E-mails enviados pelo sistema</h2>
        <p className="settings-section-desc">
          Os avisos do sistema (convite, redefinição de senha, horário de acesso, alertas e assinaturas pausadas) saem em
          HTML, com o nome, a cor e o logo da marca. Abra um deles para ajustar o assunto e o texto, ver a prévia e mandar
          um teste. Os relatórios enviados por assinatura ou pelo botão de enviar usam o assunto e a mensagem de cada
          envio, dentro do mesmo layout.
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
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingTemplate(template)}>
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing === "server" && <EmailServerModal settings={loaded} onSaved={setLoaded} onClose={close} />}
      {editing === "test" && <EmailTestModal onClose={close} />}
      {editing === "logo" && <EmailLogoModal settings={loaded} onChanged={setLoaded} onClose={close} />}

      {editingTemplate && (
        <EmailTemplateModal
          template={editingTemplate}
          canSendTest={loaded.configured}
          onSaved={handleTemplateSaved}
          onClose={() => setEditingTemplate(null)}
        />
      )}
    </div>
  );
}
