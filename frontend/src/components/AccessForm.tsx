import { useMemo, useState } from "react";
import type { AccessCatalog, AccessPermission } from "../api/access";
import type { Workspace } from "../api/workspaces";
import { GLOBAL_SCOPE, removeScope, scopeKey, setFeature, setScope, togglePermission } from "../utils/accessDraft";
import type { Draft } from "../utils/accessDraft";
import type { Inherited } from "../utils/accessInherited";

const PRESET_LABELS: { key: string; label: string }[] = [
  { key: "leitor", label: "Leitor" },
  { key: "editor", label: "Editor" },
  { key: "administrador", label: "Administrador" },
];

/** O que a lista mostra dentro de uma seção: uma permissão sozinha, ou um grupo de itens com um interruptor-mestre.
 * No grupo, `items` são todos os itens (o interruptor-mestre age em todos) e `shown` os que passam na pesquisa. */
type Entry =
  | { kind: "single"; permission: AccessPermission }
  | { kind: "feature"; feature: string; label: string; description: string; items: AccessPermission[]; shown: AccessPermission[] };

/** Uma seção da lista: o nome, o que aparece (já filtrado pela pesquisa) e todas as permissões dela (para o contador) */
type Section = { name: string; entries: Entry[]; all: AccessPermission[] };

/** Tira acentos e maiúsculas, para a pesquisa achar "assinatura" em "Assinaturas" e "ia" em "IA" */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesQuery(permission: AccessPermission, query: string): boolean {
  if (!query) return true;
  const text = `${permission.label} ${permission.description} ${permission.feature_label ?? ""} ${permission.section}`;
  return normalize(text).includes(query);
}

function entriesOf(permissions: AccessPermission[], query: string): Entry[] {
  const entries: Entry[] = [];
  for (const permission of permissions) {
    const visible = matchesQuery(permission, query);
    if (!permission.feature) {
      if (visible) entries.push({ kind: "single", permission });
      continue;
    }
    let entry = entries.find((e): e is Extract<Entry, { kind: "feature" }> => e.kind === "feature" && e.feature === permission.feature);
    if (!entry) {
      entry = {
        kind: "feature",
        feature: permission.feature,
        label: permission.feature_label ?? permission.feature,
        description: permission.feature_description ?? "",
        items: [],
        shown: [],
      };
      entries.push(entry);
    }
    entry.items.push(permission);
    if (visible) entry.shown.push(permission);
  }
  return entries.filter((entry) => entry.kind === "single" || entry.shown.length > 0);
}

function sectionsOf(permissions: AccessPermission[], query: string): Section[] {
  const bySection = new Map<string, AccessPermission[]>();
  for (const permission of permissions) {
    bySection.set(permission.section, [...(bySection.get(permission.section) ?? []), permission]);
  }
  return [...bySection.entries()]
    .map(([name, all]) => ({ name, entries: entriesOf(all, query), all }))
    .filter((section) => section.entries.length > 0);
}

const sectionKey = (scope: string, name: string) => `${scope}|${name}`;

interface Props {
  /** Prefixo dos ids dos interruptores, para duas listas na mesma tela não se misturarem */
  idPrefix: string;
  catalog: AccessCatalog;
  workspaces: Workspace[];
  draft: Draft;
  onChange: (next: Draft) => void;
  /** Falso quando a pessoa ou o grupo já tem tudo */
  editable?: boolean;
  disabled?: boolean;
  /** Permissões que a pessoa já recebe por grupos: aparecem ligadas e travadas, com o nome do grupo */
  inherited?: Inherited;
  /** Atalho para onde se vê e edita o grupo; sem ele, o aviso de grupo não leva a lugar nenhum */
  onOpenGroups?: () => void;
  /** Quem recebe as permissões, no texto de "nenhuma coleção" */
  subjectLabel?: string;
  /** Quem está mexendo só dá e tira o que tem: o que não tem aparece travado, com aviso. Sem isto, tudo é permitido. */
  allowed?: (scope: string, key: string) => boolean;
}

/** A lista de permissões: as do sistema todo e as de cada coleção, com atalhos Leitor, Editor e Administrador por
 * coleção. Cada permissão tem o seu interruptor; as que fazem parte de um grupo de itens também podem ser ligadas ou
 * desligadas todas de uma vez pelo interruptor do grupo. Como a lista é grande, as seções vêm fechadas (cada uma mostra
 * quantas permissões tem ligadas) e há uma pesquisa que abre só o que combina. Não guarda nada de permissão: quem usa
 * mantém o rascunho (ver `AccessEditor`, que salva, e a janela de adicionar membro). */
export default function AccessForm({
  idPrefix,
  catalog,
  workspaces,
  draft,
  onChange,
  editable = true,
  disabled = false,
  inherited = {},
  onOpenGroups,
  subjectLabel = "a pessoa",
  allowed = () => true,
}: Props) {
  const [toAdd, setToAdd] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const locked = !editable || disabled;
  const permissions = catalog.permissions;
  const query = normalize(search.trim());
  const searching = query.length > 0;

  const globalPermissions = useMemo(() => permissions.filter((p) => p.scope === "global"), [permissions]);
  const workspacePermissions = useMemo(() => permissions.filter((p) => p.scope === "workspace"), [permissions]);
  const globalSections = useMemo(() => sectionsOf(globalPermissions, query), [globalPermissions, query]);
  const workspaceSections = useMemo(() => sectionsOf(workspacePermissions, query), [workspacePermissions, query]);

  // Mostra as coleções com permissão avulsa no rascunho e as em que a pessoa já recebe algo por grupo
  const scopes = new Set([...Object.keys(draft), ...Object.keys(inherited)]);
  scopes.delete(GLOBAL_SCOPE);
  const activeWorkspaceIds = [...scopes].map(Number).sort((a, b) => a - b);
  // Só se pode liberar uma coleção que a própria pessoa enxerga
  const availableWorkspaces = workspaces.filter((w) => !scopes.has(String(w.id)) && allowed(String(w.id), "colecao.ver"));
  const workspaceName = (workspaceId: number) => workspaces.find((w) => w.id === workspaceId)?.name ?? `Coleção ${workspaceId}`;

  const noResults = searching && globalSections.length === 0 && workspaceSections.length === 0;

  function toggleSection(key: string) {
    if (searching) return;
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    const names = (list: AccessPermission[]) => [...new Set(list.map((p) => p.section))];
    const keys = [
      ...names(globalPermissions).map((name) => sectionKey(GLOBAL_SCOPE, name)),
      ...activeWorkspaceIds.flatMap((id) => names(workspacePermissions).map((name) => sectionKey(scopeKey(id), name))),
    ];
    setOpen(new Set(keys));
  }

  // Tem alguma permissao marcada nesta coleção que a pessoa nao tem (e portanto nao pode tirar)?
  const hasNotHeld = (scope: string) => [...(draft[scope] ?? [])].some((key) => !allowed(scope, key));

  function renderRow(scope: string, permission: AccessPermission, child: boolean) {
    const inputId = `${idPrefix}-${scope}-${permission.key}`;
    const fromGroups = inherited[scope]?.[permission.key];
    const checked = Boolean(fromGroups) || (draft[scope]?.has(permission.key) ?? false);
    const notHeld = !allowed(scope, permission.key);
    return (
      <div key={permission.key} className={`access-row ${child ? "access-row-child" : ""}`}>
        <div className="access-row-text">
          <span id={`${inputId}-label`} className="access-row-label">
            {permission.label}
          </span>
          <span id={`${inputId}-hint`} className="access-check-hint">
            {permission.description}
          </span>
          {notHeld && !fromGroups && (
            <span className="access-check-origin">Você não tem esta permissão, então não pode dá-la nem tirá-la.</span>
          )}
          {fromGroups && (
            <span className="access-check-origin">
              Vem do grupo {fromGroups.join(", ")}.
              {onOpenGroups && (
                <>
                  {" "}
                  <button type="button" className="access-link" onClick={onOpenGroups}>
                    Ver no grupo
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        {/* Interruptor liga e desliga: o que vem de grupo fica ligado e travado */}
        <label className="toggle-switch">
          <input
            id={inputId}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={Boolean(fromGroups) || notHeld}
            aria-labelledby={`${inputId}-label`}
            aria-describedby={`${inputId}-hint`}
            onChange={(e) => onChange(togglePermission(draft, scope, permission.key, e.target.checked, permissions))}
          />
          <span className="toggle-switch-track" />
        </label>
      </div>
    );
  }

  function renderFeature(scope: string, entry: Extract<Entry, { kind: "feature" }>) {
    const inputId = `${idPrefix}-${scope}-feature-${entry.feature}`;
    const fixed = new Set(entry.items.filter((item) => inherited[scope]?.[item.key]).map((item) => item.key));
    // O que vem de grupo e o que a pessoa nao tem ficam como estao quando o interruptor-mestre e mexido
    const locked = new Set([...fixed, ...entry.items.filter((item) => !allowed(scope, item.key)).map((item) => item.key)]);
    const isOn = (key: string) => fixed.has(key) || (draft[scope]?.has(key) ?? false);
    const active = entry.items.filter((item) => isOn(item.key)).length;
    const all = active === entry.items.length;
    return (
      <div key={entry.feature} className="access-feature">
        <div className="access-row access-row-master">
          <div className="access-row-text">
            <span id={`${inputId}-label`} className="access-row-label">
              {entry.label}
            </span>
            <span id={`${inputId}-hint`} className="access-check-hint">
              {entry.description}
            </span>
            <span className="access-feature-count" aria-live="polite">
              {active} de {entry.items.length} ligadas
            </span>
          </div>
          {/* Interruptor do grupo: liga ou desliga todos os itens de uma vez */}
          <label className="toggle-switch">
            <input
              id={inputId}
              type="checkbox"
              role="switch"
              checked={all}
              disabled={locked.size === entry.items.length}
              aria-labelledby={`${inputId}-label`}
              aria-describedby={`${inputId}-hint`}
              onChange={(e) =>
                onChange(
                  setFeature(
                    draft,
                    scope,
                    entry.items.map((item) => item.key),
                    e.target.checked,
                    permissions,
                    locked,
                  ),
                )
              }
            />
            <span className="toggle-switch-track" />
          </label>
        </div>
        <div className="access-feature-items">{entry.shown.map((item) => renderRow(scope, item, true))}</div>
      </div>
    );
  }

  function renderList(scope: string, sections: Section[]) {
    return sections.map((section) => {
      const key = sectionKey(scope, section.name);
      const isOpen = searching || open.has(key);
      const on = section.all.filter((p) => Boolean(inherited[scope]?.[p.key]) || (draft[scope]?.has(p.key) ?? false)).length;
      const bodyId = `${idPrefix}-${scope}-${section.name}-body`.replace(/\s+/g, "-");
      return (
        <div key={section.name} className="access-section">
          <button
            type="button"
            className="access-section-head"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => toggleSection(key)}
          >
            <span className={`material-symbols-outlined access-section-caret ${isOpen ? "access-section-caret-open" : ""}`} aria-hidden="true">
              expand_more
            </span>
            <span className="access-section-title">{section.name}</span>
            <span className={`access-section-count ${on > 0 ? "access-section-count-on" : ""}`}>
              {on} de {section.all.length} ligadas
            </span>
          </button>
          <fieldset id={bodyId} className="access-fieldset" disabled={locked} hidden={!isOpen}>
            {section.entries.map((entry) => (entry.kind === "single" ? renderRow(scope, entry.permission, false) : renderFeature(scope, entry)))}
          </fieldset>
        </div>
      );
    });
  }

  return (
    <>
      <div className="access-toolbar">
        <input
          type="search"
          className="input access-search"
          placeholder="Pesquisar permissão"
          aria-label="Pesquisar permissões"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={expandAll} disabled={searching}>
          Expandir tudo
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(new Set())} disabled={searching}>
          Recolher tudo
        </button>
      </div>

      {noResults && <p className="access-empty">Nenhuma permissão encontrada para “{search.trim()}”.</p>}

      {(!searching || globalSections.length > 0) && (
        <section className="access-card" aria-label="Permissões do sistema todo">
          <h4 className="access-card-title">Em todo o sistema</h4>
          <div className="access-grid">{renderList(GLOBAL_SCOPE, globalSections)}</div>
        </section>
      )}

      {(!searching || workspaceSections.length > 0) && (
        <>
          <h4 className="access-block-title">Por coleção</h4>
          {activeWorkspaceIds.length === 0 && (
            <p className="access-empty">Nenhuma coleção liberada. Adicione uma coleção para escolher o que {subjectLabel} pode fazer nela.</p>
          )}
          {activeWorkspaceIds.map((workspaceId) => {
            const scope = scopeKey(workspaceId);
            const hasInherited = Boolean(inherited[scope]);
            return (
              <section key={workspaceId} className="access-card" aria-label={`Permissões em ${workspaceName(workspaceId)}`}>
                <div className="access-card-head">
                  <h4 className="access-card-title">{workspaceName(workspaceId)}</h4>
                  {editable && (
                    <div className="access-presets" role="group" aria-label="Atalhos">
                      {PRESET_LABELS.map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={disabled}
                          onClick={() =>
                            // O que já vem de grupo não entra no rascunho (já está ligado e travado), e só entra o que a
                            // pessoa tem; o que ela não tem e já estava marcado continua como estava
                            onChange(
                              setScope(draft, scope, [
                                ...[...(draft[scope] ?? [])].filter((key) => !allowed(scope, key)),
                                ...(catalog.presets[preset.key] ?? []).filter((key) => !inherited[scope]?.[key] && allowed(scope, key)),
                              ]),
                            )
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                      {(draft[scope]?.size ?? 0) > 0 || !hasInherited ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm access-remove"
                          disabled={disabled || hasNotHeld(scope)}
                          title={hasNotHeld(scope) ? "Há permissões aqui que você não tem, então não pode tirá-las" : undefined}
                          onClick={() => onChange(removeScope(draft, scope))}
                        >
                          {hasInherited ? "Limpar avulsas" : "Remover coleção"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="access-grid">{renderList(scope, workspaceSections)}</div>
              </section>
            );
          })}
        </>
      )}

      {editable && availableWorkspaces.length > 0 && (
        <div className="access-add">
          <select className="input" aria-label="Coleção para adicionar" value={toAdd} onChange={(e) => setToAdd(e.target.value)} disabled={disabled}>
            <option value="">Escolha uma coleção</option>
            {availableWorkspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!toAdd || disabled}
            onClick={() => {
              // Entra só com "ver a coleção"; o resto o admin liga ou escolhe por um atalho
              onChange(setScope(draft, toAdd, (catalog.presets.leitor ?? []).filter((key) => allowed(toAdd, key))));
              setToAdd("");
            }}
          >
            Adicionar coleção
          </button>
        </div>
      )}
    </>
  );
}
