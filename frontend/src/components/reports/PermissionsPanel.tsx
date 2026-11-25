import { useCallback, useEffect, useRef, useState } from "react";
import * as panelApi from "../../api/accessPanel";
import type { Panel, PanelEntry, PanelKind, Subject } from "../../api/accessPanel";
import { extractErrorMessage } from "../../api/client";
import { useToast } from "../../context/ToastContext";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { Avatar } from "./Avatar";

const EMAIL = /^\S+@\S+\.\S+$/;
const CUSTOM = "__custom";
const REMOVE = "__remove";

interface Undo {
  text: string;
  run: () => Promise<void>;
}

function originText(entry: PanelEntry): string {
  return entry.origins.length === 0 ? "Sem acesso direto" : entry.origins.map((o) => o.label).join(" · ");
}

/** "Gerenciar permissões" de um relatório ou de um modelo, no estilo do Power BI Service: quem tem acesso (pessoas e grupos,
 * com preset e origem), um campo só para adicionar (com autocompletar e convite por e-mail) e "Personalizar" para o detalhe
 * de cada item. Cada mudança grava na hora e dá para desfazer. Os dados são os mesmos de Gerenciar usuários. */
export default function PermissionsPanel({
  kind,
  itemId,
  itemName,
  onClose,
  onChanged,
}: {
  kind: PanelKind;
  itemId: number;
  itemName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { showToast } = useToast();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Subject[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [customOpen, setCustomOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [busy, setBusy] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEscapeKey(onClose, true);

  const load = useCallback(async () => {
    try {
      setPanel(await panelApi.getPanel(kind, itemId));
      setLoadError(null);
    } catch (err) {
      setLoadError(extractErrorMessage(err) || "Não foi possível carregar as permissões.");
    }
  }, [kind, itemId]);

  useEffect(() => {
    void load();
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [load]);

  // Autocompletar: espera um instante depois da ultima tecla
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      panelApi
        .searchSubjects(text)
        .then((list) => {
          if (!cancelled) {
            setSuggestions(list);
            setHighlight(0);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query]);

  function offerUndo(next: Undo) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(next);
    undoTimer.current = setTimeout(() => setUndo(null), 9000);
  }

  async function apply(entry: Pick<PanelEntry, "subject_kind" | "subject_id" | "name" | "permissions">, value: { preset?: string | null; permissions?: string[] }, text: string) {
    const previous = entry.permissions;
    setBusy(true);
    try {
      await panelApi.putSubject(kind, itemId, entry.subject_kind, entry.subject_id, value);
      await load();
      onChanged?.();
      offerUndo({
        text,
        run: async () => {
          await panelApi.putSubject(kind, itemId, entry.subject_kind, entry.subject_id, { permissions: previous });
          await load();
          onChanged?.();
        },
      });
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível mudar o acesso.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function addSubject(subject: Subject) {
    if (!panel) return;
    setQuery("");
    setSuggestions([]);
    const existing = panel.entries.find((e) => e.subject_kind === subject.kind && e.subject_id === subject.id);
    const first = panel.presets[0]?.key ?? "ver";
    await apply(
      existing ?? { subject_kind: subject.kind, subject_id: subject.id, name: subject.name, permissions: [] },
      { preset: first },
      `${subject.name} agora tem acesso.`,
    );
  }

  async function inviteEmail(email: string) {
    if (!panel) return;
    setQuery("");
    setSuggestions([]);
    setBusy(true);
    try {
      const result = await panelApi.inviteByEmail(kind, itemId, email, panel.presets[0]?.key ?? "ver");
      await load();
      onChanged?.();
      showToast(result.status === "applied" ? "Acesso dado." : "Convite criado. Avise a pessoa para se cadastrar com este e-mail.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível convidar.", "error");
    } finally {
      setBusy(false);
    }
  }

  const trimmed = query.trim();
  // Contas do Power BI nao tem convite por e-mail: a pessoa precisa ja ter conta no portal
  const emailOption = kind !== "connection" && EMAIL.test(trimmed) && !suggestions.some((s) => s.email?.toLowerCase() === trimmed.toLowerCase());
  const options: { key: string; label: string; sub?: string; subject?: Subject; email?: string }[] = [
    ...suggestions.map((s) => ({ key: `${s.kind}:${s.id}`, label: s.name, sub: s.kind === "group" ? "Grupo" : s.email ?? "", subject: s })),
    ...(emailOption ? [{ key: `email:${trimmed}`, label: `Convidar ${trimmed}`, sub: "Cria um convite com este acesso", email: trimmed }] : []),
  ];

  function chooseOption(option: (typeof options)[number]) {
    if (option.subject) void addSubject(option.subject);
    else if (option.email) void inviteEmail(option.email);
  }

  function onSelect(entry: PanelEntry, value: string) {
    if (value === CUSTOM) {
      setCustomOpen(customOpen === entryKey(entry) ? null : entryKey(entry));
      return;
    }
    if (value === REMOVE) {
      void apply(entry, { permissions: [] }, `Acesso de ${entry.name} removido.`);
      return;
    }
    if (value) void apply(entry, { preset: value }, `Acesso de ${entry.name} mudou.`);
  }

  function toggleKey(entry: PanelEntry, key: string, on: boolean) {
    const next = on ? [...entry.permissions, key] : entry.permissions.filter((k) => k !== key);
    void apply(entry, { permissions: next }, `Acesso de ${entry.name} mudou.`);
  }

  const title = kind === "report" ? "relatório" : kind === "dataset" ? "modelo" : "conta";

  return (
    <>
      <div className="rpt-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="rpt-drawer" role="dialog" aria-modal="true" aria-label={`Gerenciar permissões do ${title} ${itemName}`}>
        <header>
          <div>
            <h2>Gerenciar permissões</h2>
            <div className="rpt-sub">{itemName}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="rpt-drawer-body">
          <div className="rpt-suggest">
            <input
              className="input"
              role="combobox"
              aria-expanded={options.length > 0}
              aria-label="Adicionar pessoas ou grupos"
              placeholder={kind === "connection" ? "Adicionar pessoas ou grupos" : "Adicionar pessoas ou grupos (nome ou e-mail)"}
              value={query}
              disabled={busy || !panel}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter" && options[highlight]) {
                  e.preventDefault();
                  chooseOption(options[highlight]);
                }
              }}
            />
            {options.length > 0 && (
              <div className="rpt-suggest-list" role="listbox">
                {options.map((option, index) => (
                  <button key={option.key} type="button" role="option" aria-selected={index === highlight} onMouseDown={(e) => e.preventDefault()} onClick={() => chooseOption(option)}>
                    <Avatar name={option.label} picture={option.subject?.picture_url} group={option.subject?.kind === "group"} />
                    <span>
                      <div>{option.label}</div>
                      {option.sub && <div className="rpt-entry-origin">{option.sub}</div>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {undo && (
            <div className="rpt-undo" role="status">
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

          {loadError && <p className="auth-error" role="alert">{loadError}</p>}
          {!panel && !loadError && (
            <div aria-hidden="true">
              <div className="rpt-skel" />
              <div className="rpt-skel" />
              <div className="rpt-skel" />
            </div>
          )}

          {panel && panel.entries.length === 0 && (
            <div className="rpt-empty" style={{ padding: "24px 8px" }}>
              <h3>Ninguém tem acesso ainda</h3>
              <p style={{ margin: 0 }}>Use o campo acima para adicionar uma pessoa, um grupo ou um e-mail.</p>
            </div>
          )}

          {panel && panel.entries.length > 0 && (
            <div role="list" aria-label="Quem tem acesso">
              {panel.entries.map((entry) => (
                <div key={entryKey(entry)} role="listitem">
                  <div className="rpt-entry">
                    <Avatar name={entry.name} picture={entry.picture_url} group={entry.subject_kind === "group"} />
                    <div style={{ minWidth: 0 }}>
                      <div className="rpt-entry-name">{entry.name}</div>
                      <div className="rpt-entry-origin">{entry.email ? `${entry.email} · ` : entry.subject_kind === "group" ? "Grupo · " : ""}{originText(entry)}</div>
                    </div>
                    <select
                      className="input"
                      style={{ minWidth: 130 }}
                      aria-label={`Acesso de ${entry.name}`}
                      value={entry.preset && entry.preset !== "personalizado" ? entry.preset : entry.permissions.length === 0 ? "" : "personalizado"}
                      disabled={busy}
                      onChange={(e) => onSelect(entry, e.target.value)}
                    >
                      {entry.permissions.length === 0 && <option value="">Pela pasta</option>}
                      {entry.preset === "personalizado" && <option value="personalizado" disabled>Personalizado</option>}
                      {panel.presets.map((preset) => (
                        <option key={preset.key} value={preset.key}>{preset.label}</option>
                      ))}
                      <option value={CUSTOM}>Personalizar…</option>
                      {entry.permissions.length > 0 && <option value={REMOVE}>Remover acesso</option>}
                    </select>
                  </div>
                  {customOpen === entryKey(entry) && (
                    <div className="rpt-custom" role="group" aria-label={`Itens de ${entry.name}`}>
                      {panel.permissions.map((permission) => (
                        <label key={permission.key} title={permission.description}>
                          <input type="checkbox" checked={entry.permissions.includes(permission.key)} disabled={busy} onChange={(e) => toggleKey(entry, permission.key, e.target.checked)} />
                          {permission.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function entryKey(entry: PanelEntry): string {
  return `${entry.subject_kind}:${entry.subject_id}`;
}
