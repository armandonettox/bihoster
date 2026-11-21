import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { extractErrorMessage } from "../../../api/client";
import { Field } from "../../../components/SettingsFields";
import SettingsEditModal from "../../../components/SettingsEditModal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";
import { getUtcOffsetLabel } from "../../../utils/datetime";
import { listTimezones } from "./timezones";

/** Nome do site, endereço, e-mail de suporte e fuso horário */
export default function GeneralAppModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const saved = {
    companyName: settings.company_name || "",
    siteUrl: settings.site_url || "",
    supportEmail: settings.support_email || "",
    timezone: settings.timezone || "America/Sao_Paulo",
  };
  const [companyName, setCompanyName] = useState(saved.companyName);
  const [siteUrl, setSiteUrl] = useState(saved.siteUrl);
  const [supportEmail, setSupportEmail] = useState(saved.supportEmail);
  const [timezone, setTimezone] = useState(saved.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    companyName !== saved.companyName ||
    siteUrl !== saved.siteUrl ||
    supportEmail !== saved.supportEmail ||
    timezone !== saved.timezone;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        company_name: companyName,
        site_url: siteUrl || null,
        support_email: supportEmail || null,
        timezone,
      });
      await reload();
      showToast("Configurações salvas.");
      onClose();
    } catch (err: any) {
      // Os campos ficam como estão: quem digitou não perde o que escreveu
      setError(extractErrorMessage(err) || "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Dados do aplicativo"
      description="Informações gerais desta instância do sistema."
      dirty={dirty}
      saving={saving}
      error={error}
      wide
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <div className="settings-grid settings-grid-two">
        <Field id="general-company-name" label="Nome do site" hint="Usado nesta instância. Aparece na barra lateral e na tela de login.">
          <input
            id="general-company-name"
            className="input"
            value={companyName}
            aria-describedby="general-company-name-hint"
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </Field>

        <Field
          id="general-site-url"
          label="URL do site"
          hint="Usada como referência em links gerados pelo sistema, como os dos e-mails. Só mude se souber o que está fazendo."
        >
          <input
            id="general-site-url"
            className="input"
            value={siteUrl}
            aria-describedby="general-site-url-hint"
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://relatorios.minhaempresa.com"
          />
        </Field>

        <Field id="general-support-email" label="E-mail de suporte" hint="Para onde os usuários devem ir se encontrarem um problema.">
          <input
            id="general-support-email"
            className="input"
            type="email"
            value={supportEmail}
            aria-describedby="general-support-email-hint"
            onChange={(e) => setSupportEmail(e.target.value)}
            placeholder="suporte@minhaempresa.com"
          />
        </Field>

        <Field
          id="general-timezone"
          label="Fuso horário"
          hint={`Usado para exibir horários em todo o portal, incluindo a Auditoria. Atual: ${getUtcOffsetLabel(timezone)}.`}
        >
          <select
            id="general-timezone"
            className="input"
            value={timezone}
            aria-describedby="general-timezone-hint"
            onChange={(e) => setTimezone(e.target.value)}
          >
            {listTimezones(timezone).map((option) => (
              <option key={option.tz} value={option.tz}>
                ({option.offsetLabel}) {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </SettingsEditModal>
  );
}
