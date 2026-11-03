import type { Report } from "../api/reports";
import KebabMenu from "./KebabMenu";

export default function ReportActionsMenu({
  report,
  canWrite,
  isFavorite,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  report: Report;
  canWrite: boolean;
  isFavorite: boolean;
  onToggleFavorite: (report: Report) => void;
  onEdit: (report: Report) => void;
  onDelete: (reportId: number) => void;
}) {
  return (
    <KebabMenu>
      {(close) => (
        <>
          <button
            className="kebab-menu-item"
            onClick={() => {
              close();
              onToggleFavorite(report);
            }}
          >
            {isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          </button>
          {canWrite && (
            <button
              className="kebab-menu-item"
              onClick={() => {
                close();
                onEdit(report);
              }}
            >
              Editar
            </button>
          )}
          {canWrite && (
            <button
              className="kebab-menu-item kebab-menu-item-danger"
              onClick={() => {
                close();
                onDelete(report.id);
              }}
            >
              Excluir
            </button>
          )}
        </>
      )}
    </KebabMenu>
  );
}
