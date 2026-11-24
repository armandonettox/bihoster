import type { Report } from "../api/reports";
import KebabMenu from "./KebabMenu";
import MenuIcon from "./MenuIcon";

export default function ReportActionsMenu({
  report,
  isFavorite,
  onToggleFavorite,
  onEdit,
  onDelete,
  onSendByEmail,
  onRefreshThumbnail,
}: {
  report: Report;
  isFavorite: boolean;
  onToggleFavorite: (report: Report) => void;
  /** Sem isso o item "Editar" nao aparece (so quem pode editar relatorios da colecao) */
  onEdit?: (report: Report) => void;
  /** Sem isso o item "Excluir" nao aparece (so quem pode excluir relatorios da colecao) */
  onDelete?: (reportId: number) => void;
  /** Sem isso o item "Enviar por e-mail" nao aparece (so quem pode e com o e-mail configurado) */
  onSendByEmail?: (report: Report) => void;
  /** Sem isso o item "Atualizar miniatura" nao aparece (so quem pode gerenciar a miniatura) */
  onRefreshThumbnail?: (report: Report) => void;
}) {
  return (
    <KebabMenu>
      {(close) => (
        <>
          <button
            className="kebab-menu-item kebab-menu-item-with-icon"
            onClick={() => {
              close();
              onToggleFavorite(report);
            }}
          >
            <MenuIcon name={isFavorite ? "star_half" : "star"} />
            {isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          </button>
          {onSendByEmail && (
            <button
              className="kebab-menu-item kebab-menu-item-with-icon"
              onClick={() => {
                close();
                onSendByEmail(report);
              }}
            >
              <MenuIcon name="mail" />
              Enviar por e-mail
            </button>
          )}
          {onRefreshThumbnail && (
            <button
              className="kebab-menu-item kebab-menu-item-with-icon"
              onClick={() => {
                close();
                onRefreshThumbnail(report);
              }}
            >
              <MenuIcon name="image" />
              Atualizar miniatura
            </button>
          )}
          {onEdit && (
            <button
              className="kebab-menu-item kebab-menu-item-with-icon"
              onClick={() => {
                close();
                onEdit(report);
              }}
            >
              <MenuIcon name="edit" />
              Editar
            </button>
          )}
          {onDelete && (
            <button
              className="kebab-menu-item kebab-menu-item-with-icon kebab-menu-item-danger"
              onClick={() => {
                close();
                onDelete(report.id);
              }}
            >
              <MenuIcon name="delete" />
              Excluir
            </button>
          )}
        </>
      )}
    </KebabMenu>
  );
}
