import * as emailApi from "../../../api/emailSettings";
import type { EmailSettings } from "../../../api/emailSettings";
import { assetUrl, extractErrorMessage } from "../../../api/client";
import ImageUploadField from "../../../components/ImageUploadField";
import Modal from "../../../components/Modal";
import { useToast } from "../../../context/ToastContext";

/** O logo do topo dos e-mails. Sem um logo próprio, os e-mails usam o da marca. Cada imagem vale assim que é enviada. */
export default function EmailLogoModal({
  settings,
  onChanged,
  onClose,
}: {
  settings: EmailSettings;
  onChanged: (updated: EmailSettings) => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();

  async function handleUpload(file: File) {
    try {
      onChanged(await emailApi.uploadEmailLogo(file));
      showToast("Logo dos e-mails atualizado.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível enviar o logo.", "error");
    }
  }

  async function handleRemove() {
    try {
      onChanged(await emailApi.removeEmailLogo());
      showToast("Logo dos e-mails removido. Os e-mails voltam a usar o logo da marca.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível remover o logo.", "error");
    }
  }

  return (
    <Modal title="Logo dos e-mails" onClose={onClose}>
      <p className="settings-section-desc">
        Aparece no topo de todos os e-mails do sistema e dos relatórios enviados. Sem um logo próprio, os e-mails usam o logo
        da marca. Para o logo aparecer, o endereço do site precisa estar preenchido em Administração &gt; Geral.
      </p>
      <ImageUploadField
        label="Logo dos e-mails"
        hint="PNG ou JPG. Fundo transparente funciona melhor; o e-mail mostra o logo com 40 px de altura."
        imageUrl={settings.email_logo_url ? assetUrl(settings.email_logo_url) : null}
        onUpload={(file) => void handleUpload(file)}
        onRemove={settings.email_logo_url ? () => void handleRemove() : undefined}
      />
      <div className="modal-actions-sticky">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
