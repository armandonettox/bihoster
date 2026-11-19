/** O resumo de permissões de uma linha (de pessoa ou de grupo). É só informação: para mudar, usa-se o "Editar" do menu
 * dos três pontinhos, que é o único caminho de edição. `muted` deixa em cinza quando não há nada a destacar (todas ou
 * nenhuma). */
export default function PermissionsBox({
  label,
  muted,
  title,
  badge,
}: {
  label: string;
  muted: boolean;
  title?: string;
  /** Selo ao lado do texto, como "avulsa" */
  badge?: string;
}) {
  return (
    <span className={`permissions-summary ${muted ? "permissions-summary-muted" : ""}`} title={title}>
      <span className="groups-cell-label">{label}</span>
      {badge && <span className="groups-cell-extra">{badge}</span>}
    </span>
  );
}
