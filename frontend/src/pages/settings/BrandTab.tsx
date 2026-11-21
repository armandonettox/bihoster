import { useState } from "react";
import type { AppSettings } from "../../api/settings";
import { useBranding } from "../../context/BrandingContext";
import SettingsRowList from "../../components/SettingsRowList";
import BrandIdentityModal from "./brand/BrandIdentityModal";
import BrandLoginModal from "./brand/BrandLoginModal";
import BrandTextScreenModal from "./brand/BrandTextScreenModal";
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, sameColor } from "./brand/brandShared";
import { TEXT_SCREENS, isTextScreenCustomized, type TextScreenDef } from "./brand/textScreens";

type Editing = { kind: "identity" } | { kind: "login" } | { kind: "text"; screen: TextScreenDef } | null;

interface Row {
  key: string;
  label: string;
  description: string;
  customized: boolean;
  edit: Editing;
}

/** A lista do que a marca personaliza, uma linha por tela. Cada linha abre a sua janela, com os campos e a prévia. */
function brandRows(settings: AppSettings | null): Row[] {
  const identityCustom =
    settings !== null &&
    (!sameColor(settings.primary_color || DEFAULT_PRIMARY, DEFAULT_PRIMARY) ||
      !sameColor(settings.secondary_color || DEFAULT_SECONDARY, DEFAULT_SECONDARY) ||
      Boolean(settings.logo_url) ||
      Boolean(settings.favicon_url));
  const loginCustom = settings !== null && (settings.login_layout === "split" || Boolean(settings.login_image_url));

  return [
    {
      key: "identity",
      label: "Cores e logos",
      description: "As cores do sistema, o logo e o favicon. Valem no menu, na tela de login, nas telas de aviso e nos e-mails.",
      customized: identityCustom,
      edit: { kind: "identity" },
    },
    {
      key: "login",
      label: "Tela de login",
      description: "O layout do formulário de entrada e a imagem do painel, quando o layout é dividido.",
      customized: loginCustom,
      edit: { kind: "login" },
    },
    ...TEXT_SCREENS.map((screen) => ({
      key: screen.id,
      label: screen.label,
      description: screen.description,
      customized: isTextScreenCustomized(settings, screen),
      edit: { kind: "text", screen } as Editing,
    })),
  ];
}

export default function BrandTab() {
  const { settings } = useBranding();
  const [editing, setEditing] = useState<Editing>(null);

  const rows = brandRows(settings);
  const close = () => setEditing(null);

  return (
    <div className="brand-layout">
      <div className="settings-section">
        <h2 className="settings-section-title">Marca e telas do sistema</h2>
        <p className="settings-section-desc">
          As cores, os logos e os textos das telas que a pessoa vê. Abra uma delas para ajustar, ver a prévia e salvar.
        </p>

        <SettingsRowList
          rows={rows.map((row) => ({
            key: row.key,
            label: row.label,
            description: row.description,
            status: row.customized ? "Personalizado" : "Padrão",
            highlight: row.customized,
            onEdit: () => setEditing(row.edit),
            disabled: settings === null,
          }))}
        />
      </div>

      {settings && editing?.kind === "identity" && <BrandIdentityModal settings={settings} onClose={close} />}
      {settings && editing?.kind === "login" && <BrandLoginModal settings={settings} onClose={close} />}
      {settings && editing?.kind === "text" && (
        <BrandTextScreenModal key={editing.screen.id} screen={editing.screen} settings={settings} onClose={close} />
      )}
    </div>
  );
}
