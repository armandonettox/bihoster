import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings, AppSettingsUpdate } from "../../../api/settings";
import { assetUrl, extractErrorMessage } from "../../../api/client";
import ErrorScreenPreview from "../../../components/ErrorScreenPreview";
import Modal from "../../../components/Modal";
import NoticeScreenPreview from "../../../components/NoticeScreenPreview";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";
import { ERROR_BUTTON_MAX, ERROR_MESSAGE_MAX, ERROR_TITLE_MAX, customText } from "../../../utils/errorScreens";
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, ErrorTextField, PREVIEW_SCALE } from "./brandShared";
import { isTextScreenCustomized, savedText, type TextScreenDef } from "./textScreens";

/** Editar uma tela de erro ou de aviso: título, mensagem e botão, com a prévia da tela ao lado (segue o que está
 * digitado, sem salvar). Campo em branco usa o texto padrão. */
export default function BrandTextScreenModal({
  screen,
  settings,
  onClose,
}: {
  screen: TextScreenDef;
  settings: AppSettings;
  onClose: () => void;
}) {
  const { reload } = useBranding();
  const { showToast } = useToast();
  const { fields } = screen;

  const [title, setTitle] = useState(savedText(settings, fields.title));
  const [message, setMessage] = useState(savedText(settings, fields.message));
  const [button, setButton] = useState(savedText(settings, fields.button));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const values = { [fields.title]: title, [fields.message]: message, [fields.button]: button } as Record<string, string>;
  const dirty = Object.entries(values).some(([field, value]) => value.trim() !== savedText(settings, field as typeof fields.title));

  // O texto que a prévia mostra: o digitado, ou o padrão onde estiver em branco
  const texts = {
    title: customText(title) ?? screen.defaults.title,
    message: customText(message) ?? screen.defaults.message,
    button: customText(button) ?? screen.defaults.button,
  };
  const primary = settings.primary_color || DEFAULT_PRIMARY;
  const secondary = settings.secondary_color || DEFAULT_SECONDARY;
  const logoUrl = settings.logo_url ? assetUrl(settings.logo_url) : null;

  async function persist(payload: AppSettingsUpdate, done: string) {
    setSaveError(null);
    setSaving(true);
    try {
      await settingsApi.updateSettings(payload);
      await reload();
      showToast(done);
      onClose();
    } catch (err: any) {
      setSaveError(extractErrorMessage(err) || "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  // Grava só o que mudou; texto apagado vai como nulo, para o servidor voltar ao padrão
  function handleSave() {
    const payload: AppSettingsUpdate = {};
    for (const [field, value] of Object.entries(values)) {
      const text = value.trim();
      if (text !== savedText(settings, field as typeof fields.title)) {
        (payload as Record<string, string | null>)[field] = text || null;
      }
    }
    if (Object.keys(payload).length === 0) return;
    void persist(payload, "Tela salva.");
  }

  function handleReset() {
    void persist({ [fields.title]: null, [fields.message]: null, [fields.button]: null } as AppSettingsUpdate, "Tela restaurada ao texto padrão.");
  }

  return (
    <Modal title={screen.label} onClose={onClose} wide>
      <p className="settings-section-desc">{screen.description}</p>

      <div className="email-editor">
        <div className="email-editor-form">
          <ErrorTextField
            id="brand-screen-title"
            label="Título"
            value={title}
            placeholder={screen.titlePlaceholder ?? screen.defaults.title}
            max={ERROR_TITLE_MAX}
            onChange={setTitle}
          />
          <ErrorTextField
            id="brand-screen-message"
            label="Mensagem"
            value={message}
            placeholder={screen.defaults.message}
            max={ERROR_MESSAGE_MAX}
            multiline
            onChange={setMessage}
          />
          <ErrorTextField
            id="brand-screen-button"
            label="Texto do botão"
            value={button}
            placeholder={screen.defaults.button}
            max={ERROR_BUTTON_MAX}
            onChange={setButton}
          />
          {screen.note && <p className="field-hint">{screen.note}</p>}
        </div>

        <div className="email-editor-preview">
          <aside aria-label={`Prévia: ${screen.label}`}>
            <h3 className="brand-preview-title">Prévia</h3>
            {screen.family === "error" ? (
              <ErrorScreenPreview
                kind={screen.id === "notFound" ? "notFound" : "error"}
                texts={texts}
                logoUrl={logoUrl}
                primaryColor={primary}
                secondaryColor={secondary}
                scale={PREVIEW_SCALE}
              />
            ) : (
              <NoticeScreenPreview
                kind={screen.id === "outsideHours" ? "outsideHours" : "noAccess"}
                texts={texts}
                logoUrl={logoUrl}
                primaryColor={primary}
                secondaryColor={secondary}
                openingLine={screen.id === "outsideHours" ? customText(message) !== null : undefined}
                scale={PREVIEW_SCALE}
              />
            )}
            <p className="field-hint brand-preview-note">{screen.previewNote}</p>
          </aside>
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
        {isTextScreenCustomized(settings, screen) && (
          <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={saving} style={{ marginLeft: "auto" }}>
            Restaurar o texto padrão
          </button>
        )}
      </div>
    </Modal>
  );
}
