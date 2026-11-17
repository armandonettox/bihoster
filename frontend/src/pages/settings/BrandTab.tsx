import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import * as settingsApi from "../../api/settings";
import type { AppSettings, AppSettingsUpdate, LoginLayout } from "../../api/settings";
import { useBranding } from "../../context/BrandingContext";
import { assetUrl } from "../../api/client";
import ImageUploadField from "../../components/ImageUploadField";
import LoginPreview from "../../components/LoginPreview";
import AppShellPreview from "../../components/AppShellPreview";
import ErrorScreenPreview from "../../components/ErrorScreenPreview";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";
import {
  DEFAULT_ERROR_TEXTS,
  ERROR_BUTTON_MAX,
  ERROR_MESSAGE_MAX,
  ERROR_TITLE_MAX,
  errorScreenTexts,
} from "../../utils/errorScreens";

// Os seis textos das telas de erro, na ordem em que aparecem na tela
const ERROR_TEXT_FIELDS = [
  "not_found_title",
  "not_found_message",
  "not_found_button",
  "error_title",
  "error_message",
  "error_button",
] as const;
type ErrorTextField = (typeof ERROR_TEXT_FIELDS)[number];
type ErrorTextValues = Record<ErrorTextField, string>;

/** O que está salvo para cada texto de erro; vazio quando o admin não personalizou (vale o padrão) */
function errorTextsFromSettings(settings: AppSettings | null): ErrorTextValues {
  return Object.fromEntries(ERROR_TEXT_FIELDS.map((field) => [field, settings?.[field] ?? ""])) as ErrorTextValues;
}

const DEFAULT_PRIMARY = "#1E3A6B";
const DEFAULT_SECONDARY = "#5B9BD5";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// As prévias ficam na coluna da direita (440 px): 0.55 dos 720 px da tela cabe com folga
const PREVIEW_SCALE = 0.55;

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

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Cor com seletor e campo de código. O rótulo aponta para o campo de código; o seletor tem nome próprio. */
function ColorField({
  id,
  label,
  color,
  hexInput,
  valid,
  onPick,
  onHexChange,
}: {
  id: string;
  label: string;
  color: string;
  hexInput: string;
  valid: boolean;
  onPick: (value: string) => void;
  onHexChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`color-field ${!valid ? "color-field-invalid" : ""}`}>
        <input type="color" value={color} aria-label={`Escolher ${label.toLowerCase()}`} onChange={(e) => onPick(e.target.value)} />
        <input
          id={id}
          className="color-field-hex"
          value={hexInput}
          onChange={(e) => onHexChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
        />
      </div>
      {!valid && (
        <span className="field-error" role="alert">
          Use o formato #RRGGBB
        </span>
      )}
    </div>
  );
}

/** Uma das duas opções de layout da tela de login */
function LayoutOption({
  checked,
  onChange,
  title,
  description,
  thumb,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
  thumb: ReactNode;
}) {
  return (
    <label className="card visibility-option brand-layout-option">
      <input type="radio" name="login_layout" checked={checked} onChange={onChange} />
      <div className="layout-thumb">{thumb}</div>
      <div>
        <div className="brand-layout-option-title">{title}</div>
        <div className="field-hint">{description}</div>
      </div>
    </label>
  );
}

/** Campo de texto de uma tela de erro: o texto padrão aparece de sugestão (placeholder) e o contador mostra o limite */
function ErrorTextField({
  id,
  label,
  value,
  placeholder,
  max,
  multiline = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const common = {
    id,
    className: "input",
    value,
    placeholder,
    maxLength: max,
    "aria-describedby": `${id}-hint`,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} style={{ resize: "vertical" }} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} onChange={(e) => onChange(e.target.value)} />
      )}
      <span id={`${id}-hint`} className="field-hint">
        {value.length}/{max}. Em branco, usa o texto padrão.
      </span>
    </div>
  );
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
  const colorsValid = primaryValid && secondaryValid;

  const savedPrimary = settings?.primary_color || DEFAULT_PRIMARY;
  const savedSecondary = settings?.secondary_color || DEFAULT_SECONDARY;
  // Mudou alguma cor em relação ao que está salvo (ou há um código digitado pela metade)? Só então a barra aparece.
  const colorsDirty =
    settings !== null &&
    (!sameColor(primaryColor, savedPrimary) || !sameColor(secondaryColor, savedSecondary) || !colorsValid);

  // Textos das telas de erro. Vazio = usar o padrão; só o que difere do salvo (sem espaços nas pontas) é mudança.
  const [errorTexts, setErrorTexts] = useState<ErrorTextValues>(() => errorTextsFromSettings(settings));
  const textsDirty =
    settings !== null && ERROR_TEXT_FIELDS.some((field) => errorTexts[field].trim() !== (settings[field] ?? ""));
  const dirty = colorsDirty || textsDirty;

  function fillFromSettings() {
    setPrimaryColor(savedPrimary);
    setSecondaryColor(savedSecondary);
    setPrimaryHexInput(savedPrimary);
    setSecondaryHexInput(savedSecondary);
    setErrorTexts(errorTextsFromSettings(settings));
  }

  useEffect(() => {
    if (!settings) return;
    fillFromSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings === null]);

  function handleErrorTextChange(field: ErrorTextField, value: string) {
    setErrorTexts((current) => ({ ...current, [field]: value }));
  }

  function handleResetErrorTexts() {
    setErrorTexts(errorTextsFromSettings(null));
  }

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

  // Grava só o que mudou: as duas cores (se alguma mudou) e cada texto de erro diferente do salvo
  async function saveChanges() {
    if (!colorsValid || saving) return;
    const payload: AppSettingsUpdate = {};
    if (!sameColor(primaryColor, savedPrimary) || !sameColor(secondaryColor, savedSecondary)) {
      payload.primary_color = primaryColor;
      payload.secondary_color = secondaryColor;
    }
    for (const field of ERROR_TEXT_FIELDS) {
      const value = errorTexts[field].trim();
      if (value !== (settings?.[field] ?? "")) payload[field] = value || null;
    }
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    try {
      await settingsApi.updateSettings(payload);
      await reload();
      showToast("Alterações salvas.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível salvar as alterações.", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void saveChanges();
  }

  async function handleLogoUpload(file: File) {
    try {
      await settingsApi.uploadLogo(file);
      await reload();
      showToast("Logo atualizado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar o logo.", "error");
    }
  }

  async function handleLogoRemove() {
    try {
      await settingsApi.removeLogo();
      await reload();
      showToast("Logo removido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível remover o logo.", "error");
    }
  }

  async function handleFaviconUpload(file: File) {
    try {
      await settingsApi.uploadFavicon(file);
      await reload();
      showToast("Favicon atualizado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar o favicon.", "error");
    }
  }

  async function handleFaviconRemove() {
    try {
      await settingsApi.removeFavicon();
      await reload();
      showToast("Favicon removido.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível remover o favicon.", "error");
    }
  }

  async function handleLoginImageUpload(file: File) {
    try {
      await settingsApi.uploadLoginImage(file);
      await reload();
      showToast("Imagem de login atualizada.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar a imagem.", "error");
    }
  }

  async function handleRemoveLoginImage() {
    try {
      await settingsApi.removeLoginImage();
      await reload();
      showToast("Imagem de login removida.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível remover a imagem.", "error");
    }
  }

  async function handleLayoutChange(layout: LoginLayout) {
    try {
      await settingsApi.updateSettings({ login_layout: layout });
      await reload();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível mudar o layout.", "error");
    }
  }

  // As prévias seguem as cores da tela, mesmo as ainda não salvas; com um código inválido, ficam na última cor boa
  const previewPrimary = primaryColor;
  const previewSecondary = secondaryColor;
  const companyName = settings?.company_name || "BIHoster";
  const logoUrl = settings?.logo_url ? assetUrl(settings.logo_url) : null;
  const loginImageUrl = settings?.login_image_url ? assetUrl(settings.login_image_url) : null;
  const loginLayout: LoginLayout = settings?.login_layout || "centered";
  // As prévias das telas de erro seguem o que está digitado, mesmo sem salvar; campo em branco mostra o padrão
  const notFoundTexts = errorScreenTexts("notFound", errorTexts);
  const errorTextsLive = errorScreenTexts("error", errorTexts);

  return (
    <div className="brand-layout">
      {/* Cartão 1: cores e logo à esquerda e, no mesmo cartão, a prévia do sistema, que depende dos dois */}
      <div className="settings-section brand-card">
        <div className="brand-card-main">
          <h2 className="settings-section-title">Cores</h2>
          <p className="settings-section-desc">
            Cores usadas no sistema inteiro, inclusive na tela de login. Só valem depois de salvar; a prévia ao lado
            mostra como ficam.
          </p>

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
                    onClick={() => handleApplyPreset(preset)}
                  >
                    <span style={{ background: preset.primary }} />
                    <span style={{ background: preset.secondary }} />
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetColors}>
                Restaurar padrão
              </button>
            </div>
          </form>

          <div className="brand-card-divider">
            <h2 className="settings-section-title">Logo e favicon</h2>
            <p className="settings-section-desc">
              O favicon aparece na aba do navegador; o logo, no menu superior e na tela de login. Cada imagem vale assim
              que você a envia.
            </p>

            <div className="settings-grid settings-grid-two">
              <ImageUploadField
                label="Logo"
                hint="PNG, JPG ou SVG. Fundo transparente funciona melhor."
                imageUrl={logoUrl}
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
        </div>

        <div className="brand-card-preview">
          <aside aria-label="Prévia do sistema">
            <h3 className="brand-preview-title">Prévia do sistema</h3>
            <AppShellPreview
              companyName={companyName}
              logoUrl={logoUrl}
              primaryColor={previewPrimary}
              secondaryColor={previewSecondary}
              scale={PREVIEW_SCALE}
              label={null}
            />
            <p className="field-hint brand-preview-note">Mostra as cores, mesmo as ainda não salvas, e o logo.</p>
          </aside>
        </div>
      </div>

      {/* Cartão 2: a escolha do login à esquerda e a prévia dele, na hora, no mesmo cartão */}
      <div className="settings-section brand-card">
        <div className="brand-card-main">
          <h2 className="settings-section-title">Tela de login</h2>
          <p className="settings-section-desc">Escolha como o formulário de login aparece. A escolha vale assim que você clica.</p>

          <div className="settings-grid settings-grid-two brand-layout-options" role="radiogroup" aria-label="Layout da tela de login">
            <LayoutOption
              checked={loginLayout === "centered"}
              onChange={() => handleLayoutChange("centered")}
              title="Centralizado"
              description="Card de login no centro da tela, sem imagem."
              thumb={<div className="layout-thumb-card" style={{ borderColor: previewPrimary }} />}
            />
            <LayoutOption
              checked={loginLayout === "split"}
              onChange={() => handleLayoutChange("split")}
              title="Dividido, com imagem"
              description="Login à esquerda e uma imagem à direita (ou um degradê com as cores da marca)."
              thumb={
                <>
                  <div className="layout-thumb-split-form" />
                  <div
                    className="layout-thumb-split-image"
                    style={{
                      background: loginImageUrl
                        ? `url(${loginImageUrl}) center/cover`
                        : `linear-gradient(135deg, ${previewPrimary}, ${previewSecondary})`,
                    }}
                  />
                </>
              }
            />
          </div>

          {loginLayout === "split" && (
            <div className="brand-login-image">
              <ImageUploadField
                label="Imagem do painel direito"
                hint="Recomendado: imagem vertical, boa resolução."
                imageUrl={loginImageUrl}
                onUpload={handleLoginImageUpload}
                onRemove={settings?.login_image_url ? handleRemoveLoginImage : undefined}
              />
            </div>
          )}
        </div>

        <div className="brand-card-preview">
          <aside aria-label="Prévia da tela de login">
            <h3 className="brand-preview-title">Prévia da tela de login</h3>
            <LoginPreview
              companyName={companyName}
              logoUrl={logoUrl}
              primaryColor={previewPrimary}
              secondaryColor={previewSecondary}
              layout={loginLayout}
              loginImageUrl={loginImageUrl}
              scale={PREVIEW_SCALE}
              label={null}
            />
            <p className="field-hint brand-preview-note">Mostra o layout, a imagem, o logo e as cores.</p>
          </aside>
        </div>
      </div>

      {/* Cartão 3: os textos das telas de erro à esquerda e a prévia de cada uma no mesmo cartão */}
      <div className="settings-section brand-card">
        <div className="brand-card-main">
          <h2 className="settings-section-title">Telas de erro</h2>
          <p className="settings-section-desc">
            Os textos das telas que aparecem quando a página não existe e quando algo dá errado. Só valem depois de
            salvar; a prévia ao lado mostra como ficam.
          </p>

          <fieldset className="brand-error-group">
            <legend>Página não encontrada (404)</legend>
            <div className="brand-error-fields">
              <ErrorTextField
                id="brand-404-title"
                label="Título"
                value={errorTexts.not_found_title}
                placeholder={DEFAULT_ERROR_TEXTS.notFound.title}
                max={ERROR_TITLE_MAX}
                onChange={(value) => handleErrorTextChange("not_found_title", value)}
              />
              <ErrorTextField
                id="brand-404-message"
                label="Mensagem"
                value={errorTexts.not_found_message}
                placeholder={DEFAULT_ERROR_TEXTS.notFound.message}
                max={ERROR_MESSAGE_MAX}
                multiline
                onChange={(value) => handleErrorTextChange("not_found_message", value)}
              />
              <ErrorTextField
                id="brand-404-button"
                label="Texto do botão"
                value={errorTexts.not_found_button}
                placeholder={DEFAULT_ERROR_TEXTS.notFound.button}
                max={ERROR_BUTTON_MAX}
                onChange={(value) => handleErrorTextChange("not_found_button", value)}
              />
            </div>
          </fieldset>

          <fieldset className="brand-error-group">
            <legend>Algo deu errado</legend>
            <div className="brand-error-fields">
              <ErrorTextField
                id="brand-error-title"
                label="Título"
                value={errorTexts.error_title}
                placeholder={DEFAULT_ERROR_TEXTS.error.title}
                max={ERROR_TITLE_MAX}
                onChange={(value) => handleErrorTextChange("error_title", value)}
              />
              <ErrorTextField
                id="brand-error-message"
                label="Mensagem"
                value={errorTexts.error_message}
                placeholder={DEFAULT_ERROR_TEXTS.error.message}
                max={ERROR_MESSAGE_MAX}
                multiline
                onChange={(value) => handleErrorTextChange("error_message", value)}
              />
              <ErrorTextField
                id="brand-error-button"
                label="Texto do botão"
                value={errorTexts.error_button}
                placeholder={DEFAULT_ERROR_TEXTS.error.button}
                max={ERROR_BUTTON_MAX}
                onChange={(value) => handleErrorTextChange("error_button", value)}
              />
            </div>
          </fieldset>

          <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetErrorTexts}>
            Restaurar textos padrão
          </button>
        </div>

        <div className="brand-card-preview">
          <aside aria-label="Prévia da página não encontrada">
            <h3 className="brand-preview-title">Prévia da página não encontrada</h3>
            <ErrorScreenPreview
              kind="notFound"
              texts={notFoundTexts}
              logoUrl={logoUrl}
              primaryColor={previewPrimary}
              secondaryColor={previewSecondary}
              scale={PREVIEW_SCALE}
            />
            <p className="field-hint brand-preview-note">Usa o logo e as cores da marca.</p>
          </aside>
          <aside aria-label="Prévia da tela de erro inesperado">
            <h3 className="brand-preview-title">Prévia de &quot;Algo deu errado&quot;</h3>
            <ErrorScreenPreview
              kind="error"
              texts={errorTextsLive}
              logoUrl={logoUrl}
              primaryColor={previewPrimary}
              secondaryColor={previewSecondary}
              scale={PREVIEW_SCALE}
            />
            <p className="field-hint brand-preview-note">
              Usa sempre o logo padrão: essa tela aparece quando algo já quebrou e não pode depender da marca.
            </p>
          </aside>
        </div>
      </div>

      {(dirty || saving) && (
        <div className="settings-savebar" role="region" aria-label="Salvar alterações">
          <button type="button" className="btn btn-primary" disabled={!colorsValid || saving} onClick={() => void saveChanges()}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          {!saving && (
            <>
              <button type="button" className="btn btn-ghost" onClick={fillFromSettings}>
                Descartar
              </button>
              <span className="settings-savebar-hint" role="status">
                {colorsValid ? "Você tem alterações não salvas." : "Corrija o código da cor para poder salvar."}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
