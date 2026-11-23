import { useState } from "react";
import * as settingsApi from "../../../api/settings";
import type { AppSettings, LoginLayout } from "../../../api/settings";
import { assetUrl, extractErrorMessage } from "../../../api/client";
import ImageUploadField from "../../../components/ImageUploadField";
import LoginPreview from "../../../components/LoginPreview";
import Modal from "../../../components/Modal";
import { useBranding } from "../../../context/BrandingContext";
import { useToast } from "../../../context/ToastContext";
import { DEFAULT_PRIMARY, DEFAULT_SECONDARY, LayoutOption, PREVIEW_SCALE } from "./brandShared";

/** O layout da tela de login e a imagem do painel direito, com a prévia ao lado. O layout vale depois de salvar (a
 * prévia já mostra o escolhido); a imagem vale assim que é enviada. */
export default function BrandLoginModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { reload } = useBranding();
  const { showToast } = useToast();

  const savedLayout: LoginLayout = settings.login_layout || "centered";
  const [layout, setLayout] = useState<LoginLayout>(savedLayout);
  const [saving, setSaving] = useState(false);
  const dirty = layout !== savedLayout;

  const primary = settings.primary_color || DEFAULT_PRIMARY;
  const secondary = settings.secondary_color || DEFAULT_SECONDARY;
  const logoUrl = settings.logo_url ? assetUrl(settings.logo_url) : null;
  const loginImageUrl = settings.login_image_url ? assetUrl(settings.login_image_url) : null;

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await settingsApi.updateSettings({ login_layout: layout });
      await reload();
      showToast("Tela de login salva.");
      onClose();
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível mudar o layout.", "error");
    } finally {
      setSaving(false);
    }
  }

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
    <Modal title="Tela de login" onClose={onClose} wide>
      <p className="settings-section-desc">
        Escolha como o formulário de login aparece. O layout vale depois de salvar; a imagem vale assim que você a envia.
      </p>

      <div className="email-editor">
        <div className="email-editor-form">
          <div className="brand-layout-options-stack" role="radiogroup" aria-label="Layout da tela de login">
            <LayoutOption
              checked={layout === "centered"}
              onChange={() => setLayout("centered")}
              title="Centralizado"
              description="Card de login no centro da tela, sem imagem."
              thumb={<div className="layout-thumb-card" style={{ borderColor: primary }} />}
            />
            <LayoutOption
              checked={layout === "split"}
              onChange={() => setLayout("split")}
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
                        : `linear-gradient(135deg, ${primary}, ${secondary})`,
                    }}
                  />
                </>
              }
            />
          </div>

          {layout === "split" && (
            <div className="brand-login-image">
              <ImageUploadField
                label="Imagem do painel direito"
                hint="Recomendado: imagem vertical, boa resolução."
                imageUrl={loginImageUrl}
                onUpload={(file) =>
                  void sendImage(() => settingsApi.uploadLoginImage(file), "Imagem de login atualizada.", "Não foi possível enviar a imagem.")
                }
                onRemove={
                  settings.login_image_url
                    ? () => void sendImage(() => settingsApi.removeLoginImage(), "Imagem de login removida.", "Não foi possível remover a imagem.")
                    : undefined
                }
              />
            </div>
          )}
        </div>

        <div className="email-editor-preview">
          <aside aria-label="Prévia da tela de login">
            <h3 className="brand-preview-title">Prévia da tela de login</h3>
            <LoginPreview
              companyName={settings.company_name || "BIHoster"}
              logoUrl={logoUrl}
              primaryColor={primary}
              secondaryColor={secondary}
              layout={layout}
              loginImageUrl={loginImageUrl}
              scale={PREVIEW_SCALE}
              label={null}
            />
            <p className="field-hint brand-preview-note">Mostra o layout, a imagem, o logo e as cores.</p>
          </aside>
        </div>
      </div>

      <div className="modal-actions-sticky">
        <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !dirty}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
