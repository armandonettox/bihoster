import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { extractErrorMessage } from "../api/client";
import * as reportAccessApi from "../api/reportAccess";
import type { Matrix, MatrixCell, MatrixWhere, Person, ReportCatalog } from "../api/reportAccess";
import * as usersApi from "../api/users";
import type { UserDirectoryEntry } from "../api/users";
import ConfirmDialog from "../components/ConfirmDialog";
import PageLoading from "../components/PageLoading";
import { SkeletonList } from "../components/Skeleton";
import { useAccess } from "../context/AccessContext";
import { useToast } from "../context/ToastContext";
import { REPORT_ACCESS_AREA_KEYS } from "../utils/adminTabs";

const PAGE_SIZE = 25;

type View = "matrix" | "person";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function labelOf(catalog: ReportCatalog | null, key: string): string {
  return catalog?.permissions.find((p) => p.key === key)?.label ?? key;
}

function Chips({ keys, muted = false, catalog }: { keys: string[]; muted?: boolean; catalog: ReportCatalog | null }) {
  if (keys.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, opacity: muted ? 0.6 : 1 }}>
      {keys.map((key) => (
        <span key={key} className="badge" style={{ fontSize: 11 }}>
          {labelOf(catalog, key)}
        </span>
      ))}
    </span>
  );
}

function Cell({ cell, catalog }: { cell: MatrixCell | undefined; catalog: ReportCatalog | null }) {
  if (!cell || (cell.direct.length === 0 && cell.inherited.length === 0)) {
    return <span style={{ color: "var(--color-text-muted)" }}>sem acesso</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {cell.direct.length > 0 && (
        <span title="Dado neste relatório">
          <Chips keys={cell.direct} catalog={catalog} />
        </span>
      )}
      {cell.inherited.length > 0 && (
        <span title="Vem da coleção em que o relatório está">
          <Chips keys={cell.inherited.filter((key) => !cell.direct.includes(key))} muted catalog={catalog} />
          {cell.inherited.some((key) => !cell.direct.includes(key)) && <span style={{ fontSize: 11 }}> (pela coleção)</span>}
        </span>
      )}
    </div>
  );
}

function MatrixView({ catalog, canEdit }: { catalog: ReportCatalog | null; canEdit: boolean }) {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [where, setWhere] = useState<MatrixWhere>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [subject, setSubject] = useState("");
  const [preset, setPreset] = useState("leitor");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const debouncedSearch = useDebounced(search, 300);

  const load = useCallback(() => {
    return reportAccessApi
      .getMatrix({ search: debouncedSearch, where, page, pageSize: PAGE_SIZE })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(extractErrorMessage(err) || "Não foi possível carregar os acessos."));
  }, [debouncedSearch, where, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    usersApi.listUsers().then(setUsers).catch(() => setUsers([]));
  }, [canEdit]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageIds = useMemo(() => data?.rows.map((row) => row.report.id) ?? [], [data]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const presetKeys = catalog?.presets[preset] ?? [];
  const [kind, rawId] = subject.split(":");
  const subjectName =
    kind === "g" ? data?.groups.find((g) => g.id === Number(rawId))?.name : users.find((u) => u.id === Number(rawId))?.name;

  async function apply() {
    setConfirming(false);
    setApplying(true);
    try {
      const result = await reportAccessApi.bulkChange({
        report_ids: Array.from(selected),
        group_ids: kind === "g" ? [Number(rawId)] : [],
        user_ids: kind === "u" ? [Number(rawId)] : [],
        permissions: presetKeys,
        mode,
      });
      showToast(result.changes === 0 ? "Nada mudou: já estava assim." : `${result.changes} acessos alterados.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível mudar os acessos.", "error");
    } finally {
      setApplying(false);
    }
  }

  const rootSelected = data ? data.rows.some((row) => selected.has(row.report.id) && row.report.in_root) : false;

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          className="input"
          style={{ flex: "1 1 240px" }}
          type="search"
          aria-label="Buscar relatório"
          placeholder="Buscar por relatório, workspace ou coleção"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input"
          style={{ flex: "0 1 200px" }}
          aria-label="Onde está"
          value={where}
          onChange={(e) => {
            setWhere(e.target.value as MatrixWhere);
            setPage(1);
          }}
        >
          <option value="all">Raiz e coleções</option>
          <option value="root">Só na Raiz (ainda não publicados)</option>
          <option value="collections">Só em coleções</option>
        </select>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} role="region" aria-label="Aplicar aos selecionados">
          <strong>{selected.size} {selected.size === 1 ? "relatório selecionado" : "relatórios selecionados"}</strong>
          <select className="input" style={{ flex: "0 1 140px" }} aria-label="Ação" value={mode} onChange={(e) => setMode(e.target.value as "add" | "remove")}>
            <option value="add">Dar</option>
            <option value="remove">Tirar</option>
          </select>
          <select className="input" style={{ flex: "0 1 200px" }} aria-label="Permissões" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.keys(catalog?.presets ?? {}).map((name) => (
              <option key={name} value={name}>
                {name === "leitor" ? "Ver o relatório" : name === "leitor-exportador" ? "Ver e exportar" : name}
              </option>
            ))}
          </select>
          <span>para</span>
          <select className="input" style={{ flex: "1 1 220px" }} aria-label="Grupo ou pessoa" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Escolha um grupo ou uma pessoa</option>
            <optgroup label="Grupos">
              {data?.groups.map((g) => (
                <option key={`g${g.id}`} value={`g:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Pessoas">
              {users.map((u) => (
                <option key={`u${u.id}`} value={`u:${u.id}`}>
                  {u.name} ({u.email})
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={!subject || applying || presetKeys.length === 0} onClick={() => setConfirming(true)}>
            {applying ? "Aplicando..." : "Aplicar"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}

      {error && <p className="auth-error">{error}</p>}
      {!data && !error ? (
        <SkeletonList count={4} />
      ) : data && data.rows.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhum relatório encontrado.</p>
      ) : data ? (
        <>
          <div className="audit-table-card">
            <table className="table">
              <thead>
                <tr>
                  {canEdit && (
                    <th scope="col" style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos desta página"
                        checked={allOnPage}
                        onChange={() => setSelected((prev) => {
                          const next = new Set(prev);
                          pageIds.forEach((id) => (allOnPage ? next.delete(id) : next.add(id)));
                          return next;
                        })}
                      />
                    </th>
                  )}
                  <th scope="col">Relatório</th>
                  <th scope="col">Onde está</th>
                  {data.groups.map((g) => (
                    <th key={g.id} scope="col">
                      {g.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.report.id}>
                    {canEdit && (
                      <td>
                        <input type="checkbox" aria-label={`Selecionar ${row.report.name}`} checked={selected.has(row.report.id)} onChange={() => toggle(row.report.id)} />
                      </td>
                    )}
                    <td>{row.report.name}</td>
                    <td>{row.report.in_root ? "Raiz (não publicado)" : row.report.collection_name}</td>
                    {data.groups.map((g) => (
                      <td key={g.id}>
                        <Cell cell={row.cells[String(g.id)]} catalog={catalog} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12 }}>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {data.total} {data.total === 1 ? "relatório" : "relatórios"} · página {data.page} de {Math.max(1, Math.ceil(data.total / PAGE_SIZE))}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(data.total / PAGE_SIZE)} onClick={() => setPage(page + 1)}>
              Próxima
            </button>
          </div>
        </>
      ) : null}

      {confirming && (
        <ConfirmDialog
          title={mode === "add" ? "Dar acesso aos relatórios" : "Tirar acesso aos relatórios"}
          message={
            `${mode === "add" ? "Dar" : "Tirar"} "${presetKeys.map((k) => labelOf(catalog, k)).join(", ")}" para ${subjectName ?? "a pessoa escolhida"} em ${selected.size} ` +
            `${selected.size === 1 ? "relatório" : "relatórios"}.` +
            (mode === "add" && rootSelected ? " Há relatórios da Raiz entre eles: este é o passo que os publica para essa pessoa ou grupo." : "") +
            (mode === "remove" ? " Tirar o acesso de ver também tira exportar, assinar e o que depende dele." : "")
          }
          confirmLabel={mode === "add" ? "Dar acesso" : "Tirar acesso"}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function PersonView({ catalog }: { catalog: ReportCatalog | null }) {
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [userId, setUserId] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    usersApi.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!userId) {
      setPerson(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    reportAccessApi
      .getPerson(Number(userId))
      .then((result) => {
        if (cancelled) return;
        setPerson(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err) || "Não foi possível ler os acessos da pessoa.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <>
      <label className="field" style={{ maxWidth: 420, marginBottom: 12 }}>
        Pessoa
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Escolha uma pessoa</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </label>
      {error && <p className="auth-error">{error}</p>}
      {loading && <SkeletonList count={3} />}
      {!loading && person?.is_admin && <p>Esta pessoa é administradora da plataforma e vê todos os relatórios.</p>}
      {!loading && person && !person.is_admin && person.rows.length === 0 && (
        <p style={{ color: "var(--color-text-muted)" }}>{person.name} não abre nenhum relatório.</p>
      )}
      {!loading && person && !person.is_admin && person.rows.length > 0 && (
        <>
          <div className="audit-table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Relatório</th>
                  <th scope="col">Onde está</th>
                  <th scope="col">O que pode</th>
                  <th scope="col">Por que</th>
                </tr>
              </thead>
              <tbody>
                {person.rows.map((row) => (
                  <tr key={row.report.id}>
                    <td>{row.report.name}</td>
                    <td>{row.report.in_root ? "Raiz" : row.report.collection_name}</td>
                    <td>
                      <Chips keys={row.permissions} catalog={catalog} />
                    </td>
                    <td>{row.sources.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {person.truncated && <p style={{ fontSize: 13 }}>A lista foi cortada: mostra só os primeiros relatórios.</p>}
        </>
      )}
    </>
  );
}

/** Acessos aos relatorios: quem pode o que em cada relatorio, direto ou pela colecao. Pagina propria, fora da
 * Administracao. Dar e tirar acesso e do administrador e de quem tem "dar e tirar permissoes"; o servidor confere de novo. */
export default function ReportAccess() {
  const access = useAccess();
  const [view, setView] = useState<View>("matrix");
  const [catalog, setCatalog] = useState<ReportCatalog | null>(null);

  useEffect(() => {
    reportAccessApi.getReportCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  if (access.loading) return <PageLoading />;
  if (!access.canAny(...REPORT_ACCESS_AREA_KEYS)) return <Navigate to="/" replace />;
  const canEdit = access.can("permissoes.editar");

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Acessos aos relatórios</h1>
        <p>
          Quem abre cada relatório. O acesso dado a uma coleção vale para todos os relatórios dela; o dado direto num
          relatório vale só nele. Relatórios da Raiz só são vistos por administradores até alguém receber acesso.
        </p>
      </div>
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button role="tab" aria-selected={view === "matrix"} className={`btn btn-sm ${view === "matrix" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("matrix")}>
          Relatórios por grupo
        </button>
        <button role="tab" aria-selected={view === "person"} className={`btn btn-sm ${view === "person" ? "btn-primary" : "btn-secondary"}`} onClick={() => setView("person")}>
          O que uma pessoa vê
        </button>
      </div>
      {view === "matrix" ? <MatrixView catalog={catalog} canEdit={canEdit} /> : <PersonView catalog={catalog} />}
    </div>
  );
}
