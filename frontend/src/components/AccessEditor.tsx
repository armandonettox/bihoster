import { useEffect, useMemo, useState } from "react";
import * as accessApi from "../api/access";
import type { AccessCatalog, SubjectKind } from "../api/access";
import { listAllWorkspaces } from "../api/workspaces";
import type { Workspace } from "../api/workspaces";
import { extractErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";
import { blocksFromDraft, draftFromBlocks, sameDraft } from "../utils/accessDraft";
import type { Draft } from "../utils/accessDraft";
import { inheritedFromReport } from "../utils/accessInherited";
import type { Inherited } from "../utils/accessInherited";
import AccessForm from "./AccessForm";
import SubjectItemGrants from "./SubjectItemGrants";

interface Props {
  kind: SubjectKind;
  id: number;
  /** Texto que explica de onde vêm as permissões (muda entre grupo e pessoa). */
  intro?: string;
  /** Atalho para a aba onde se edita um grupo (usado nas permissões que a pessoa recebe por grupo). */
  onOpenGroups?: () => void;
  /** Quem pode ver as permissões mas não dar nem tirar (sem a permissão de dar permissões): mostra tudo travado, sem Salvar. */
  readOnly?: boolean;
  /** Quem está mexendo só dá e tira o que tem (ver `AccessForm`); sem isto, tudo é permitido e o servidor confere */
  allowed?: (scope: string, key: string) => boolean;
}

/** Permissões de um grupo ou de uma pessoa: as de sistema inteiro e as de cada coleção. Tudo se marca no rascunho e
 * grava com um Salvar só. Numa pessoa, o que ela já recebe por grupos aparece marcado e travado, com o nome do grupo:
 * as permissões da pessoa só somam, então o que o grupo dá se muda no grupo. */
export default function AccessEditor({ kind, id, intro, onOpenGroups, readOnly = false, allowed }: Props) {
  const { showToast } = useToast();
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [inherited, setInherited] = useState<Inherited>({});
  const [saved, setSaved] = useState<Draft>({});
  const [draft, setDraft] = useState<Draft>({});
  const [editable, setEditable] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      accessApi.getAccessCatalog(),
      listAllWorkspaces(),
      accessApi.getGrants(kind, id),
      kind === "user" ? accessApi.getAccessReport({ user_id: id }) : Promise.resolve([]),
    ])
      .then(([loadedCatalog, loadedWorkspaces, grants, reportRows]) => {
        if (cancelled) return;
        const loaded = draftFromBlocks(grants.blocks);
        setCatalog(loadedCatalog);
        setWorkspaces(loadedWorkspaces);
        setInherited(inheritedFromReport(reportRows));
        setSaved(loaded);
        setDraft(loaded);
        setEditable(grants.editable);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const dirty = useMemo(() => !sameDraft(saved, draft), [saved, draft]);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await accessApi.setGrants(kind, id, blocksFromDraft(draft));
      const loaded = draftFromBlocks(result.blocks);
      setSaved(loaded);
      setDraft(loaded);
      showToast("Permissões salvas.");
    } catch (err: any) {
      showToast(extractErrorMessage(err) || "Não foi possível salvar as permissões.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="auth-error">Não foi possível carregar as permissões.</p>;
  if (!catalog) return null;

  return (
    <div className="access-editor">
      {intro && <p className="access-intro">{intro}</p>}
      {!editable && (
        <p className="access-intro">
          {kind === "group" ? "O grupo Administradores" : "Quem está no grupo Administradores"} já tem todas as permissões, em
          todas as coleções.
        </p>
      )}

      {readOnly && editable && (
        <p className="access-intro">Você pode ver estas permissões, mas não tem a permissão de dar ou tirar permissões.</p>
      )}

      <AccessForm
        idPrefix={`${kind}-${id}`}
        catalog={catalog}
        workspaces={workspaces}
        draft={draft}
        onChange={setDraft}
        editable={editable && !readOnly}
        disabled={saving}
        inherited={inherited}
        onOpenGroups={onOpenGroups}
        subjectLabel={kind === "group" ? "o grupo" : "a pessoa"}
        allowed={allowed}
      />

      {editable && <SubjectItemGrants subjectKind={kind} subjectId={id} readOnly={readOnly} />}

      {editable && !readOnly && (dirty || saving) && (
        <div className="settings-savebar" role="region" aria-label="Salvar permissões">
          <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={handleSave}>
            {saving ? "Salvando..." : "Salvar permissões"}
          </button>
          {!saving && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(saved)}>
                Descartar
              </button>
              <span className="settings-savebar-hint" role="status">
                Você tem alterações não salvas.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
