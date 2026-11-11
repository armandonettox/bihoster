import { useEffect, useMemo, useState } from "react";
import {
  searchAuditLogs,
  type AuditFilters,
  type AuditLogEntry,
  type AuditPage,
  type AuditPerson,
} from "../../api/audit";
import { SkeletonList } from "../Skeleton";
import { formatDateTime } from "../../utils/datetime";
import type { AuditFilterState } from "../../utils/auditFilterState";
import { todayIn } from "../../utils/auditPeriod";
import FilterValue from "./FilterValue";
import PersonHover from "./PersonHover";

const PAGE_SIZE = 25;

interface Props {
  filters: AuditFilters;
  timezone?: string;
  /** Detalhes das pessoas, para o cartao que abre ao passar o cursor no nome */
  people?: AuditPerson[];
  /** Clicar no valor de uma coluna filtra por ele: o pai aplica o que a tabela pedir */
  onFilterBy?: (patch: Partial<AuditFilterState>) => void;
}

function describe(log: AuditLogEntry): string {
  if (log.action === "login" && log.details === "google") return "Entrou pelo Google";
  if (log.action === "register" && log.details === "google") return "Conta criada pelo Google";
  return log.details || "";
}

type Result = { key: string; data?: AuditPage; failed?: boolean };

/** Aba Registros: busca por texto, filtros comuns e paginacao, tudo feito no servidor. */
export default function AuditTable({ filters, timezone, people, onFilterBy }: Props) {
  const peopleById = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [pageState, setPageState] = useState({ scope: "", page: 1 });
  const [result, setResult] = useState<Result | null>(null);

  // Espera a pessoa parar de digitar para nao buscar a cada letra
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  // Mudou filtro ou busca: volta para a pagina 1 (derivado, sem efeito extra)
  const scope = `${JSON.stringify(filters)}|${query}`;
  const page = pageState.scope === scope ? pageState.page : 1;
  const requestKey = `${scope}|${page}`;

  useEffect(() => {
    let cancelled = false;
    searchAuditLogs(filters, query, page, PAGE_SIZE)
      .then((data) => !cancelled && setResult({ key: requestKey, data }))
      .catch(() => !cancelled && setResult({ key: requestKey, failed: true }));
    return () => {
      cancelled = true;
    };
    // requestKey ja resume filters, query e page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loading = result?.key !== requestKey;
  const data = result?.key === requestKey ? result.data : undefined;
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div className="audit-search">
        <span className="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          className="input"
          type="search"
          placeholder="Buscar por pessoa, acao, colecao ou detalhe..."
          aria-label="Buscar na auditoria"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {loading ? (
        <SkeletonList count={5} />
      ) : result?.failed ? (
        <p className="audit-empty" role="alert">Nao foi possivel carregar a auditoria.</p>
      ) : !data || data.items.length === 0 ? (
        <p className="audit-empty">Nenhum registro encontrado com esses filtros.</p>
      ) : (
        <div className="card audit-table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Acao</th>
                <th>Recurso</th>
                <th>Onde</th>
                <th>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((log) => (
                <tr key={log.id}>
                  <td className="audit-when">
                    <FilterValue
                      hint="Filtrar por este dia"
                      onClick={() => {
                        const day = todayIn(timezone, new Date(log.created_at));
                        onFilterBy?.({ period: "custom", customFrom: day, customTo: day });
                      }}
                    >
                      {formatDateTime(log.created_at, timezone)}
                    </FilterValue>
                  </td>
                  <td>
                    <PersonHover
                      name={log.user_name}
                      email={log.user_email}
                      person={log.user_id != null ? peopleById.get(log.user_id) : undefined}
                      timezone={timezone}
                      onFilter={(userId) => onFilterBy?.({ userIds: [String(userId)] })}
                    />
                  </td>
                  <td>
                    <FilterValue hint="Filtrar por esta acao" onClick={() => onFilterBy?.({ actions: [log.action] })}>
                      {log.action_label || log.action}
                    </FilterValue>
                  </td>
                  <td>
                    <FilterValue hint="Filtrar por este recurso" onClick={() => onFilterBy?.({ entities: [log.entity] })}>
                      {log.entity_label || log.entity}
                    </FilterValue>
                  </td>
                  <td>
                    {log.workspace_id != null && log.workspace_name ? (
                      <FilterValue
                        hint="Filtrar por esta colecao"
                        onClick={() => onFilterBy?.({ workspaceIds: [String(log.workspace_id)] })}
                      >
                        {log.workspace_name}
                      </FilterValue>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td className="audit-details">
                    {describe(log) && log.details ? (
                      <FilterValue hint="Buscar por este texto" onClick={() => setText(log.details as string)}>
                        {describe(log)}
                      </FilterValue>
                    ) : (
                      describe(log)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && total > 0 && (
        <div className="audit-pager">
          <span>
            {firstItem}-{lastItem} de {total}
          </span>
          <div>
            <button
              className="btn btn-ghost"
              disabled={page <= 1}
              onClick={() => setPageState({ scope, page: page - 1 })}
            >
              Anterior
            </button>
            <button
              className="btn btn-ghost"
              disabled={page >= lastPage}
              onClick={() => setPageState({ scope, page: page + 1 })}
            >
              Proxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
