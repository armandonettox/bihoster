import { useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import KebabMenu from "./KebabMenu";

interface ImageUploadFieldProps {
  label: string;
  hint: string;
  imageUrl: string | null;
  onUpload: (file: File) => void;
  onRemove?: () => void;
  wide?: boolean;
}

export default function ImageUploadField({ label, hint, imageUrl, onUpload, onRemove, wide }: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUpload(file);
    event.target.value = "";
  }

  function handleConfirmRemove() {
    setConfirmingRemove(false);
    onRemove?.();
  }

  const confirmDialog = confirmingRemove && (
    <ConfirmDialog
      title={`Remover ${label.toLowerCase()}`}
      message={`Tem certeza que deseja remover ${label.toLowerCase()}? O sistema volta a usar o padrao ate que uma nova imagem seja enviada.`}
      confirmLabel="Remover"
      onConfirm={handleConfirmRemove}
      onCancel={() => setConfirmingRemove(false)}
    />
  );

  const imageMenu = (close: () => void) => (
    <>
      <button
        type="button"
        className="kebab-menu-item"
        onClick={() => {
          close();
          inputRef.current?.click();
        }}
      >
        Trocar imagem
      </button>
      {onRemove && (
        <button
          type="button"
          className="kebab-menu-item kebab-menu-item-danger"
          onClick={() => {
            close();
            setConfirmingRemove(true);
          }}
        >
          Remover
        </button>
      )}
    </>
  );

  if (wide) {
    return (
      <div className="field">
        {label}
        <div className="image-upload-wide" onClick={() => !imageUrl && inputRef.current?.click()}>
          {imageUrl ? (
            <div className="image-upload-preview-wrap" style={{ width: "100%" }}>
              <div className="image-upload-wide-preview">
                <img src={imageUrl} alt={label} />
              </div>
              <div className="image-upload-overlay-menu">
                <KebabMenu>{imageMenu}</KebabMenu>
              </div>
            </div>
          ) : (
            <p className="image-upload-hint" style={{ margin: 0 }}>
              Clique para enviar uma imagem
            </p>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="image-upload-input" onChange={handleFileChange} />
        {confirmDialog}
      </div>
    );
  }

  return (
    <div className="field">
      {label}
      <div className="image-upload">
        <div className="image-upload-preview-wrap">
          <div className="image-upload-preview">
            {imageUrl ? <img src={imageUrl} alt={label} /> : <span className="image-upload-preview-empty">sem imagem</span>}
          </div>
          {imageUrl && (
            <div className="image-upload-overlay-menu image-upload-overlay-menu-narrow">
              <KebabMenu>{imageMenu}</KebabMenu>
            </div>
          )}
        </div>
        <div className="image-upload-actions">
          {!imageUrl && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
              Enviar imagem
            </button>
          )}
          <p className="image-upload-hint">{hint}</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="image-upload-input" onChange={handleFileChange} />
      {confirmDialog}
    </div>
  );
}
