import { useEffect, useState, type FormEvent } from "react";
import * as settingsApi from "../../api/settings";
import type { LoginLayout } from "../../api/settings";
import { useBranding } from "../../context/BrandingContext";
import { assetUrl } from "../../api/client";
import ImageUploadField from "../../components/ImageUploadField";
import LoginPreview from "../../components/LoginPreview";
import AppShellPreview from "../../components/AppShellPreview";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";

const DEFAULT_PRIMARY = "#1E3A6B";
const DEFAULT_SECONDARY = "#5B9BD5";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const PRESET_PALETTES: { name: string; primary: string; secondary: string }[] = [
  { name: "Netto Code", primary: "#1E3A6B", secondary: "#5B9BD5" },
  { name: "Grafite", primary: "#1F2937", secondary: "#6B7280" },
  { name: "Esmeralda", primary: "#065F46", secondary: "#10B981" },
  { name: "Vinho", primary: "#7F1D1D", secondary: "#F87171" },
  { name: "Roxo", primary: "#4C1D95", secondary: "#A78BFA" },
  { name: "Laranja", primary: "#9A3412", secondary: "#FB923C" },
];

function normalizeHex(value: string): string {
  let v = value.trim();
  if (!v.startsWith("#")) v = `#${v}`;
  return v;
}

export default function BrandTab() {
  const { settings, reload } = useBranding();
  const [primaryColor, setPrimaryColor] = useState(settings?.primary_color || DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(settings?.secondary_color || DEFAULT_SECONDARY);
  const [primaryHexInput, setPrimaryHexInput] = useState(primaryColor);
  const [secondaryHexInput, setSecondaryHexInput] = useState(secondaryColor);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const primaryValid = HEX_COLOR_PATTERN.test(primaryHexInput);
  const secondaryValid = HEX_COLOR_PATTERN.test(secondaryHexInput);

  useEffect(() => {
    if (!settings) return;
    setPrimaryColor(settings.primary_color);
    setSecondaryColor(settings.secondary_color);
    setPrimaryHexInput(settings.primary_color);
    setSecondaryHexInput(settings.secondary_color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings === null]);

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

  function handleResetColors() {
    setPrimaryColor(DEFAULT_PRIMARY);
    setSecondaryColor(DEFAULT_SECONDARY);
    setPrimaryHexInput(DEFAULT_PRIMARY);
    setSecondaryHexInput(DEFAULT_SECONDARY);
  }

  function handleApplyPreset(preset: { primary: string; secondary: string }) {
    setPrimaryColor(preset.primary);
    setSecondaryColor(preset.secondary);
    setPrimaryHexInput(preset.primary);
    setSecondaryHexInput(preset.secondary);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!primaryValid || !secondaryValid) {
      showToast("Corrija os codigos de cor invalidos antes de salvar.", "error");
      return;
    }
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        primary_color: primaryColor,
        secondary_color: secondaryColor,
      });
      await reload();
      showToast("Configuracoes salvas.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar as cores.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    try {
      await settingsApi.uploadLogo(file);
      await reload();
      showToast("Logo atualizado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel enviar o logo.", "error");
    }
  }

  async function handleLogoRemove() {
    try {
      await settingsApi.removeLogo();
      await reload();
      showToast("Logo removido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover o logo.", "error");
    }
  }

  async function handleFaviconUpload(file: File) {
    try {
      await settingsApi.uploadFavicon(file);
      await reload();
      showToast("Favicon atualizado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel enviar o favicon.", "error");
    }
  }

  async function handleFaviconRemove() {
    try {
      await settingsApi.removeFavicon();
      await reload();
      showToast("Favicon removido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover o favicon.", "error");
    }
  }

  async function handleLoginImageUpload(file: File) {
    try {
      await settingsApi.uploadLoginImage(file);
      await reload();
      showToast("Imagem de login atualizada.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel enviar a imagem.", "error");
    }
  }

  async function handleRemoveLoginImage() {
    try {
      await settingsApi.removeLoginImage();
      await reload();
      showToast("Imagem de login removida.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel remover a imagem.", "error");
    }
  }

  async function handleLayoutChange(layout: LoginLayout) {
    try {
      await settingsApi.updateSettings({ login_layout: layout });
      await reload();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Nao foi possivel mudar o layout.", "error");
    }
  }

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Cores</h2>
        <p className="settings-section-desc">
          Cores usadas no sistema inteiro -- aparecem em todos os workspaces e ate na tela de login.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="settings-grid">
            <label className="field">
              Cor primaria
              <div className={`color-field ${!primaryValid ? "color-field-invalid" : ""}`}>
                <input type="color" value={primaryColor} onChange={(e) => handlePrimaryPickerChange(e.target.value)} />
                <input
                  className="color-field-hex"
                  value={primaryHexInput}
                  onChange={(e) => handlePrimaryHexChange(e.target.value)}
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
              {!primaryValid && <span className="field-error">Use o formato #RRGGBB</span>}
            </label>
            <label className="field">
              Cor secundaria
              <div className={`color-field ${!secondaryValid ? "color-field-invalid" : ""}`}>
                <input type="color" value={secondaryColor} onChange={(e) => handleSecondaryPickerChange(e.target.value)} />
                <input
                  className="color-field-hex"
                  value={secondaryHexInput}
                  onChange={(e) => handleSecondaryHexChange(e.target.value)}
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
              {!secondaryValid && <span className="field-error">Use o formato #RRGGBB</span>}
            </label>
          </div>

          <div style={{ marginTop: 20 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)", display: "block", marginBottom: 8 }}>
              Paletas prontas
            </span>
            <div className="preset-palette-row">
              {PRESET_PALETTES.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="preset-palette-swatch"
                  title={preset.name}
                  onClick={() => handleApplyPreset(preset)}
                >
                  <span style={{ background: preset.primary }} />
                  <span style={{ background: preset.secondary }} />
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <AppShellPreview
              companyName={settings?.company_name || "BIHoster"}
              logoUrl={settings?.logo_url ? assetUrl(settings.logo_url) : null}
              primaryColor={primaryValid ? primaryColor : DEFAULT_PRIMARY}
              secondaryColor={secondaryValid ? secondaryColor : DEFAULT_SECONDARY}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleResetColors}>
              Restaurar padrao
            </button>
          </div>
        </form>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Logo e favicon</h2>
        <p className="settings-section-desc">O favicon aparece na aba do navegador; o logo, no menu superior e na tela de login.</p>

        <div className="settings-grid">
          <ImageUploadField
            label="Logo"
            hint="PNG, JPG ou SVG. Fundo transparente funciona melhor."
            imageUrl={settings?.logo_url ? assetUrl(settings.logo_url) : null}
            onUpload={handleLogoUpload}
            onRemove={settings?.logo_url ? handleLogoRemove : undefined}
          />
          <ImageUploadField
            label="Favicon"
            hint="Imagem quadrada pequena (32x32 ou maior)."
            imageUrl={settings?.favicon_url ? assetUrl(settings.favicon_url) : null}
            onUpload={handleFaviconUpload}
            onRemove={settings?.favicon_url ? handleFaviconRemove : undefined}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Tela de login</h2>
        <p className="settings-section-desc">Escolha como o formulario de login aparece.</p>

        <div className="settings-grid" style={{ marginBottom: settings?.login_layout === "split" ? 20 : 0 }}>
          <label className="card visibility-option" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <input
                type="radio"
                name="login_layout"
                checked={(settings?.login_layout || "centered") === "centered"}
                onChange={() => handleLayoutChange("centered")}
                style={{ marginTop: 3 }}
              />
              <div className="layout-thumb">
                <div
                  className="layout-thumb-card"
                  style={{ borderColor: primaryValid ? primaryColor : DEFAULT_PRIMARY }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Centralizado</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  Card de login centralizado na tela, sem imagem.
                </div>
              </div>
            </div>
          </label>
          <label className="card visibility-option" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <input
                type="radio"
                name="login_layout"
                checked={settings?.login_layout === "split"}
                onChange={() => handleLayoutChange("split")}
                style={{ marginTop: 3 }}
              />
              <div className="layout-thumb">
                <div className="layout-thumb-split-form" />
                <div
                  className="layout-thumb-split-image"
                  style={{
                    background: settings?.login_image_url
                      ? `url(${assetUrl(settings.login_image_url)}) center/cover`
                      : `linear-gradient(135deg, ${primaryValid ? primaryColor : DEFAULT_PRIMARY}, ${
                          secondaryValid ? secondaryColor : DEFAULT_SECONDARY
                        })`,
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Dividido, com imagem</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  Login a esquerda, imagem de sua escolha a direita (ou um degrade com as cores da
                  marca, se nenhuma imagem for enviada).
                </div>
              </div>
            </div>
          </label>
        </div>

        {settings?.login_layout === "split" && (
          <ImageUploadField
            label="Imagem do painel direito"
            hint="Recomendado: imagem vertical, boa resolucao."
            imageUrl={settings?.login_image_url ? assetUrl(settings.login_image_url) : null}
            onUpload={handleLoginImageUpload}
            onRemove={settings?.login_image_url ? handleRemoveLoginImage : undefined}
            wide
          />
        )}

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <LoginPreview
            companyName={settings?.company_name || "BIHoster"}
            logoUrl={settings?.logo_url ? assetUrl(settings.logo_url) : null}
            primaryColor={primaryValid ? primaryColor : DEFAULT_PRIMARY}
            secondaryColor={secondaryValid ? secondaryColor : DEFAULT_SECONDARY}
            layout={settings?.login_layout || "centered"}
            loginImageUrl={settings?.login_image_url ? assetUrl(settings.login_image_url) : null}
          />
        </div>
      </div>
    </div>
  );
}
