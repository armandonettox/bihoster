import { useContext, useState } from "react";
import { AccessContext } from "../../context/AccessContext";
import ScheduleEditor from "../ScheduleEditor";

/** "Horário de acesso do relatório" no fim do painel Gerenciar permissões: so para quem pode definir horarios. O editor
 * carrega na primeira vez que a secao e aberta, para o painel nao fazer uma consulta que quase ninguem usa. */
export default function ReportScheduleSection({ reportId }: { reportId: number }) {
  const access = useContext(AccessContext);
  const [opened, setOpened] = useState(false);
  if (!access?.can("membros.horario")) return null;
  return (
    <details className="rpt-schedule" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpened(true)}>
      <summary>Horário de acesso do relatório</summary>
      {opened && <ScheduleEditor kind="report" id={reportId} />}
    </details>
  );
}
