import { useCallback, useEffect, useRef, useState } from "react";
import * as panelApi from "../api/accessPanel";
import type { KindCatalog, PanelKind, SubjectItem, SubjectKind } from "../api/accessPanel";
import { extractErrorMessage } from "../api/client";
import * as connectionsApi from "../api/powerbiConnections";
import * as reportAccessApi from "../api/reportAccess";
import type { Person } from "../api/reportAccess";
import * as catalogApi from "../api/workspaceCatalog";
import type { CatalogItem } from "../api/workspaceCatalog";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 10;
const CUSTOM = "__custom";
const REMOVE = "__remove";

interface Undo {
  text: string;
  run: () => Promise<void>;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const TITLES: Record<PanelKind, { section: string; add: string; empty: string }> = {
  report: { section: "Relatórios", add: "Adicionar relatório", empty: "Nenhum relatório dado direto." },
  dataset: { section: "Modelos semânticos", add: "Adicionar modelo", empty: "Nenhum modelo dado direto." },
  connection: { section: "Contas do Power BI", add: "Adicionar conta", empty: "Nenhuma conta dada direto." },
};

function ItemSection({
  kind,
  subjectKind,
  subjectId,
  readOnly,
  onUndo,
}: {
  kind: PanelKind;
  subjectKind: SubjectKind;
  subjectId: number;
  readOnly: boolean;
  onUndo: (undo: Undo) => void;
}) {
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState<KindCatalog | null>(null);
  const [rows, setRows] = useState<SubjectItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState("");
  const [options, setOptions] = useState<CatalogItem[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search, 250);
  const debouncedAdd = useDebounced(adding, 250);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await panelApi.itemsOfSubject(subjectKind, subjectId, { kind, search: debounced, page, pageSize: PAGE_SIZE });
      if (current !== request.current) return;
      setRows(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      if (current === request.current) setError(extractErrorMessage(err) || "Não foi possível carregar.");
    }
  }, [kind, subjectKind, subjectId, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    panelApi.getKindCatalog(kind).then((c) => !cancelled && setCatalog(c)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Autocompletar de "Adicionar": os itens do catalogo que casam com o texto
  useEffect(() => {
    const text = debouncedAdd.trim();
    if (!text) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    // Contas vem da lista de contas (precisa ver as conexoes); relatorios e modelos, do catalogo
    const source: Promise<CatalogItem[]> =
      kind === "connection"
        ? connectionsApi.listConnections().then((list) =>
            list
              .filter((c) => c.name.toLowerCase().includes(text.toLowerCase()))
              .slice(0, 8)
              .map((c) => ({ id: c.id, name: c.name, pbi_workspace_name: c.tenant_id }) as CatalogItem),
          )
        : catalogApi.listItems({ kind, search: text, pageSize: 8 }).then((result) => result.items);
    source
      .then((found) => {
        if (cancelled) return;
        setOptions(found);
        setAddError(null);
      })
      .catch(() => !cancelled && setAddError(kind === "connection" ? "Você não tem acesso à lista de contas para buscar." : "Você não tem acesso ao catálogo para buscar."));
    return () => {
      cancelled = true;
    };
  }, [debouncedAdd, kind]);

  async function change(item: Pick<SubjectItem, "id" | "name" | "permissions">, value: { preset?: string | null; permissions?: string[] }, text: string) {
    const previous = item.permissions;
    try {
      await panelApi.putSubject(kind, item.id, subjectKind, subjectId, value);
      await load();
      onUndo({
        text,
        run: async () => {
          await panelApi.putSubject(kind, item.id, subjectKind, subjectId, { permissions: previous });
          await load();
        },
      });
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível mudar o acesso.", "error");
    }
  }

  const first = catalog?.presets[0]?.key ?? "ver";
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rpt-section" aria-label={TITLES[kind].section}>
      <h4>
        {TITLES[kind].section}
        <span className="rpt-muted" style={{ fontWeight: 400 }}> · {total} {total === 1 ? "com acesso direto" : "com acesso direto"}</span>
      </h4>

      {(total > PAGE_SIZE || search) && (
        <input className="input" type="search" aria-label={`Buscar em ${TITLES[kind].section}`} placeholder="Buscar" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ marginBottom: 8 }} />
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!rows && !error && <div className="rpt-skel" aria-hidden="true" />}
      {rows && rows.length === 0 && !search && <p className="rpt-muted" style={{ margin: "0 0 8px" }}>{TITLES[kind].empty}</p>}
      {rows && rows.length === 0 && search && <p className="rpt-muted" style={{ margin: "0 0 8px" }}>Nada encontrado.</p>}
      {rows?.map((row) => (
        <div key={row.id}>
          <div className="rpt-item-row">
            <span style={{ minWidth: 0 }}>
              <strong>{row.name}</strong>
              <span className="rpt-muted"> {row.in_root ? "· só no catálogo" : row.subtitle ? `· ${row.subtitle}` : ""}</span>
            </span>
            <select
              className="input"
              aria-label={`Acesso a ${row.name}`}
              disabled={readOnly || !catalog}
              value={row.preset && row.preset !== "personalizado" ? row.preset : "personalizado"}
              onChange={(e) => {
                const value = e.target.value;
                if (value === CUSTOM) setCustomOpen(customOpen === row.id ? null : row.id);
                else if (value === REMOVE) void change(row, { permissions: [] }, `Acesso a ${row.name} removido.`);
                else if (value !== "personalizado") void change(row, { preset: value }, `Acesso a ${row.name} mudou.`);
              }}
            >
              {row.preset === "personalizado" && <option value="personalizado" disabled>Personalizado</option>}
              {catalog?.presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value={CUSTOM}>Personalizar…</option>
              <option value={REMOVE}>Remover acesso</option>
            </select>
            <span />
          </div>
          {customOpen === row.id && catalog && (
            <div className="rpt-custom" style={{ paddingLeft: 8 }} role="group" aria-label={`Itens de ${row.name}`}>
              {catalog.permissions.map((p) => (
                <label key={p.key} title={p.description}>
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={row.permissions.includes(p.key)}
                    onChange={(e) => void change(row, { permissions: e.target.checked ? [...row.permissions, p.key] : row.permissions.filter((k) => k !== p.key) }, `Acesso a ${row.name} mudou.`)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 8 }}>
          <span className="rpt-muted" style={{ fontSize: 12 }}>página {page} de {pageCount}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      )}

      {!readOnly && (
        <div className="rpt-suggest" style={{ marginTop: 10 }}>
          <input className="input" role="combobox" aria-expanded={options.length > 0} aria-label={TITLES[kind].add} placeholder={`${TITLES[kind].add} (buscar pelo nome)`} value={adding} onChange={(e) => setAdding(e.target.value)} />
          {addError && <p className="auth-error" style={{ margin: "4px 0 0" }}>{addError}</p>}
          {options.length > 0 && (
            <div className="rpt-suggest-list" role="listbox">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAdding("");
                    setOptions([]);
                    const existing = rows?.find((r) => r.id === option.id);
                    void change(existing ?? { id: option.id, name: option.name, permissions: [] }, { preset: first }, `Acesso a ${option.name} dado.`);
                  }}
                >
                  <span>{option.name}<div className="rpt-entry-origin">{option.pbi_workspace_name}</div></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** "O que esta pessoa vê e por quê": cada relatório que ela abre e de onde vem o acesso, paginado e com busca. */
function PersonVision({ userId }: { userId: number }) {
  const [data, setData] = useState<Person | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search, 250);

  useEffect(() => {
    let cancelled = false;
    reportAccessApi
      .getPerson(userId, { page, search: debounced, pageSize: 10 })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(extractErrorMessage(err) || "Não foi possível carregar."));
    return () => {
      cancelled = true;
    };
  }, [userId, page, debounced]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / (data.page_size || 10))) : 1;
  return (
    <section className="rpt-section" aria-label="O que esta pessoa vê e por quê">
      <h4>O que esta pessoa vê e por quê</h4>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!data && !error && <div className="rpt-skel" aria-hidden="true" />}
      {data?.is_admin && <p style={{ margin: 0 }}>Administradora da plataforma: vê todos os relatórios.</p>}
      {data && !data.is_admin && (
        <>
          <input className="input" type="search" aria-label="Buscar relatório" placeholder="Buscar relatório" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ marginBottom: 8 }} />
          {data.rows.length === 0 && <p className="rpt-muted" style={{ margin: 0 }}>{search ? "Nada encontrado." : "Esta pessoa não abre nenhum relatório."}</p>}
          {data.rows.map((row) => (
            <div key={row.report.id} className="rpt-item-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span><strong>{row.report.name}</strong> <span className="rpt-muted">· {row.report.in_root ? "catálogo" : row.report.collection_name}</span></span>
              <span className="rpt-muted">{row.sources.join(", ")}</span>
            </div>
          ))}
          {data.total > data.page_size && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 8 }}>
              <span className="rpt-muted" style={{ fontSize: 12 }}>{data.total} relatórios · página {page} de {pageCount}</span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Próxima</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Relatórios e modelos que uma pessoa ou um grupo recebeu DIRETO, com preset e "Personalizar", mais (nas pessoas) o que ela vê e
 * por quê. É a mesma fonte do painel "Gerenciar permissões" do módulo Relatórios: mudar aqui muda lá. Cada mudança grava na hora e dá
 * para desfazer. */
export default function SubjectItemGrants({ subjectKind, subjectId, readOnly = false }: { subjectKind: SubjectKind; subjectId: number; readOnly?: boolean }) {
  const [undo, setUndo] = useState<Undo | null>(null);
  const { showToast } = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function offer(next: Undo) {
    if (timer.current) clearTimeout(timer.current);
    setUndo(next);
    timer.current = setTimeout(() => setUndo(null), 9000);
  }

  return (
    <div className="subject-item-grants">
      <h3 style={{ margin: "18px 0 0", fontSize: 15 }}>Relatórios, modelos e contas</h3>
      <p className="access-intro" style={{ margin: "4px 0 0" }}>
        O que foi dado direto num relatório, modelo ou conta do Power BI. É o mesmo que o painel Gerenciar permissões mostra.
      </p>
      {undo && (
        <div className="rpt-undo" role="status" style={{ marginTop: 8 }}>
          <span>{undo.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const run = undo.run;
              setUndo(null);
              try {
                await run();
              } catch (err) {
                showToast(extractErrorMessage(err) || "Não foi possível desfazer.", "error");
              }
            }}
          >
            Desfazer
          </button>
        </div>
      )}
      <ItemSection kind="report" subjectKind={subjectKind} subjectId={subjectId} readOnly={readOnly} onUndo={offer} />
      <ItemSection kind="dataset" subjectKind={subjectKind} subjectId={subjectId} readOnly={readOnly} onUndo={offer} />
      <ItemSection kind="connection" subjectKind={subjectKind} subjectId={subjectId} readOnly={readOnly} onUndo={offer} />
      {subjectKind === "user" && <PersonVision userId={subjectId} />}
    </div>
  );
}
