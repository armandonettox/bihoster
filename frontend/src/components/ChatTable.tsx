import type { ChatTable as ChatTableData } from "../api/aiChat";
import { columnLabel, formatCell } from "../utils/chatFormat";

/** Tabela do resultado de uma consulta. O texto das celulas entra como texto, nunca como HTML. */
export default function ChatTable({ table }: { table: ChatTableData }) {
  if (table.rows.length === 0) {
    return <p className="chat-hint">A consulta nao devolveu linhas.</p>;
  }

  const cut = table.truncated || table.total_rows > table.rows.length;

  return (
    <div className="chat-table-block">
      <div className="chat-table-wrap">
        <table className="chat-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column} title={column}>
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {table.columns.map((column) => (
                  <td key={column} className={typeof row[column] === "number" ? "chat-table-number" : undefined}>
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chat-hint">
        {cut
          ? `Mostrando as primeiras ${table.rows.length} de ${table.total_rows} linhas.`
          : `${table.rows.length} ${table.rows.length === 1 ? "linha" : "linhas"}.`}
      </p>
    </div>
  );
}
