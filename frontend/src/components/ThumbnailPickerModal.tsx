import { useEffect, useState } from "react";
import type { Report, ReportPage } from "../api/reports";
import * as reportsApi from "../api/reports";
import { extractErrorMessage } from "../api/client";
import Modal from "./Modal";

export default function ThumbnailPickerModal({
  report,
  workspaceId,
  onDone,
  onClose,
}: {
  report: Report;
  workspaceId: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<ReportPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    reportsApi
      .getReportPages(workspaceId, report.id)
      .then(setPages)
      .catch((err) => setError(extractErrorMessage(err) || "Nao foi possivel carregar as paginas."))
      .finally(() => setLoading(false));
  }, [workspaceId, report.id]);

  async function handlePick(pageName: string | null) {
    setSaving(true);
    setError(null);
    try {
      await reportsApi.refreshThumbnail(workspaceId, report.id, pageName);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel gerar o thumbnail.");
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await reportsApi.clearThumbnail(workspaceId, report.id);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel remover o thumbnail.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Atualizar miniatura" onClose={onClose}>
      <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
        Escolha a pagina do relatorio que sera usada como miniatura do card.
      </p>

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Carregando paginas...</p>}

      {!loading && error && (
        <p role="alert" style={{ color: "var(--color-danger)", marginBottom: 12 }}>{error}</p>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {pages.map((page) => (
            <button
              key={page.name}
              className="btn btn-secondary"
              onClick={() => handlePick(page.name)}
              disabled={saving}
            >
              {page.display_name}
            </button>
          ))}
          {pages.length === 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => handlePick(null)}
              disabled={saving}
            >
              Usar pagina principal
            </button>
          )}
        </div>
      )}

      {report.thumbnail_url && !loading && (
        <button
          className="btn btn-ghost"
          onClick={handleClear}
          disabled={saving}
          style={{ width: "100%", marginTop: 4 }}
        >
          Remover miniatura (voltar ao embed ao vivo)
        </button>
      )}

      {saving && (
        <p style={{ color: "var(--color-text-muted)", marginTop: 8, fontSize: 13 }}>
          Gerando miniatura...
        </p>
      )}
    </Modal>
  );
}
