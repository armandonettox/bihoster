import { useState } from "react";
import { useBranding } from "../../context/BrandingContext";
import SettingsRowList, { type SettingsRow } from "../../components/SettingsRowList";
import AuthGoogleModal from "./auth/AuthGoogleModal";
import AuthRegistrationModal from "./auth/AuthRegistrationModal";

type Editing = "registration" | "google" | null;

export default function AuthTab() {
  const { settings } = useBranding();
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  const registrationOn = settings?.allow_registration ?? true;
  const googleOn = settings?.google_oauth_enabled ?? false;
  const googleDomains = settings?.google_allowed_domains?.trim();

  const rows: SettingsRow[] = [
    {
      key: "registration",
      label: "Criação de conta",
      description: "Se novas pessoas podem se cadastrar sozinhas pela tela de login.",
      status: registrationOn ? "Permitida" : "Bloqueada",
      highlight: registrationOn,
      onEdit: () => setEditing("registration"),
      disabled: settings === null,
    },
    {
      key: "google",
      label: "Login com Google",
      description: "Entrar com uma conta Google, com a lista de domínios aceitos.",
      summary: googleOn ? (googleDomains ? `Domínios: ${googleDomains}` : "Qualquer conta Google") : undefined,
      status: googleOn ? "Ligado" : "Desligado",
      highlight: googleOn,
      onEdit: () => setEditing("google"),
      disabled: settings === null,
    },
  ];

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Autenticação</h2>
        <p className="settings-section-desc">Como as pessoas criam conta e entram no sistema. Abra uma parte para ajustar e salvar.</p>
        <SettingsRowList rows={rows} />
      </div>

      {settings && editing === "registration" && <AuthRegistrationModal settings={settings} onClose={close} />}
      {settings && editing === "google" && <AuthGoogleModal settings={settings} onClose={close} />}
    </div>
  );
}
