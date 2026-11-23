import { useState, type FormEvent } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings } from "../../../api/settings";
import { assetUrl, extractErrorMessage } from "../../../api/client";
import AppShellPreview from "../../../components/AppShellPreview";
import ImageUploadField from "../../../components/ImageUploadField";
import Modal from "../../../components/Modal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";
import {
  ColorField,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  HEX_COLOR_PATTERN,
  PREVIEW_SCALE,
  PRESET_PALETTES,
  normalizeHex,
  sameColor,
} from "./brandShared";

/** Cores, logo e favicon da marca, com a prévia do sistema ao lado. As cores valem depois de salvar (a prévia já
 * mostra as ainda não salvas); o logo e o favicon valem assim que são enviados. */
export default function BrandIdentityModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const savedPrimary = settings.primary_color || DEFAULT_PRIMARY;
  const savedSecondary = settings.secondary_color || DEFAULT_SECONDARY;
  const [primaryColor, setPrimaryColor] = useState(savedPrimary);
  const [secondaryColor, setSecondaryColor] = useState(savedSecondary);
  const [primaryHexInput, setPrimaryHexInput] = useState(savedPrimary);
  const [secondaryHexInput, setSecondaryHexInput] = useState(savedSecondary);
  const [saving, setSaving] = useState(false);

  const primaryValid = HEX_COLOR_PATTERN.test(primaryHexInput);
  const secondaryValid = HEX_COLOR_PATTERN.test(secondaryHexInput);
  const colorsValid = primaryValid && secondaryValid;
  // Mudou alguma cor em relação ao que está salvo (ou há um código digitado pela metade)?
  const dirty = !sameColor(primaryColor, savedPrimary) || !sameColor(secondaryColor, savedSecondary) || !colorsValid;

  const logoUrl = settings.logo_url ? assetUrl(settings.logo_url) : null;

  function handlePrimaryPickerChange(value: string) {
    setPrimaryColor(value);
    setPrimaryHexInput(value);
  }

  function handlePrimaryHexChange(value: string) {
    setPrimaryHexInput(value);
    const normalized = normalizeHex(value);
    if (HEX_COLOR_PATTERN.test(normalized)) setPrimaryColor(normalized);
  }

  function handleSecondaryPickerChange(value: string) {
    setSecondaryColor(value);
    setSecondaryHexInput(value);
  }

  function handleSecondaryHexChange(value: string) {
    setSecondaryHexInput(value);
    const normalized = normalizeHex(value);
    if (HEX_COLOR_PATTERN.test(normalized)) setSecondaryColor(normalized);
  }

  function applyColors(primary: string, secondary: string) {
    setPrimaryColor(primary);
    setSecondaryColor(secondary);
    setPrimaryHexInput(primary);
    setSecondaryHexInput(secondary);
  }

  async function handleSave() {
    if (!colorsValid || !dirty || saving) return;
    setSaving(true);
    try {
      await settingsApi.updateSettings({ primary_color: primaryColor, secondary_color: secondaryColor });
      await reload();
      showToast("Cores salvas.");
      onClose();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível salvar as alterações.", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void handleSave();
  }

  // Cada envio de imagem vale na hora: grava, recarrega a marca e avisa
  async function sendImage(action: () => Promise<unknown>, done: string, failed: string) {
    try {
      await action();
      await reload();
      showToast(done);
    } catch (err: any) {
      showToast(extractErrorMessage(err) || failed, "error");
    }
  }

  return (
    <Modal title="Cores e logos" onClose={onClose} wide>
      <p className="settings-section-desc">
        As cores valem no sistema inteiro, inclusive na tela de login e nos e-mails, e só depois de salvar. O logo e o favicon
        valem assim que você os envia.
      </p>

      <div className="email-editor">
        <div className="email-editor-form">
          <form onSubmit={handleSubmit}>
            <div className="settings-grid settings-grid-two">
              <ColorField
                id="brand-primary-hex"
                label="Cor primária"
                color={primaryColor}
                hexInput={primaryHexInput}
                valid={primaryValid}
                onPick={handlePrimaryPickerChange}
                onHexChange={handlePrimaryHexChange}
              />
              <ColorField
                id="brand-secondary-hex"
                label="Cor secundária"
                color={secondaryColor}
                hexInput={secondaryHexInput}
                valid={secondaryValid}
                onPick={handleSecondaryPickerChange}
                onHexChange={handleSecondaryHexChange}
              />
            </div>

            <div className="brand-palettes">
              <span className="field-hint">Paletas prontas</span>
              <div className="preset-palette-row">
                {PRESET_PALETTES.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="preset-palette-swatch"
                    title={preset.name}
                    aria-label={`Aplicar a paleta ${preset.name}`}
                    onClick={() => applyColors(preset.primary, preset.secondary)}
                  >
                    <span style={{ background: preset.primary }} />
                    <span style={{ background: preset.secondary }} />
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyColors(DEFAULT_PRIMARY, DEFAULT_SECONDARY)}>
                Restaurar padrão
              </button>
            </div>
          </form>

          <div className="brand-card-divider">
            <h3 className="brand-preview-title">Logo e favicon</h3>
            <p className="field-hint">
              O favicon aparece na aba do navegador; o logo, no menu superior, na tela de login e nos e-mails (a menos que os
              e-mails tenham um logo próprio).
            </p>
            <div className="settings-stack">
              <ImageUploadField
                label="Logo"
                hint="PNG, JPG ou SVG. Fundo transparente funciona melhor."
                imageUrl={logoUrl}
                onUpload={(file) => void sendImage(() => settingsApi.uploadLogo(file), "Logo atualizado.", "Não foi possível enviar o logo.")}
                onRemove={
                  settings.logo_url
                    ? () => void sendImage(() => settingsApi.removeLogo(), "Logo removido.", "Não foi possível remover o logo.")
                    : undefined
                }
              />
              <ImageUploadField
                label="Favicon"
                hint="Imagem quadrada pequena (32x32 ou maior)."
                imageUrl={settings.favicon_url ? assetUrl(settings.favicon_url) : null}
                onUpload={(file) =>
                  void sendImage(() => settingsApi.uploadFavicon(file), "Favicon atualizado.", "Não foi possível enviar o favicon.")
                }
                onRemove={
                  settings.favicon_url
                    ? () => void sendImage(() => settingsApi.removeFavicon(), "Favicon removido.", "Não foi possível remover o favicon.")
                    : undefined
                }
              />
            </div>
          </div>
        </div>

        <div className="email-editor-preview">
          <aside aria-label="Prévia do sistema">
            <h3 className="brand-preview-title">Prévia do sistema</h3>
            <AppShellPreview
              companyName={settings.company_name || "BIHoster"}
              logoUrl={logoUrl}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              scale={PREVIEW_SCALE}
              label={null}
            />
            <p className="field-hint brand-preview-note">Mostra as cores, mesmo as ainda não salvas, e o logo.</p>
          </aside>
        </div>
      </div>

      <div className="modal-actions-sticky">
        <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !dirty || !colorsValid}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Fechar
        </button>
        {!colorsValid && <span className="field-hint">Corrija o código da cor para poder salvar.</span>}
      </div>
    </Modal>
  );
}
