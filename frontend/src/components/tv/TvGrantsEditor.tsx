import { useEffect, useMemo, useState } from "react";
import { extractErrorMessage } from "../../api/client";
import {
  getTvGrants,
  listTvPeople,
  replaceTvGrants,
  type TvGrant,
  type TvLevel,
  type TvPerson,
} from "../../api/tvs";
import { useToast } from "../../context/ToastContext";
import MenuIcon from "../MenuIcon";

const LEVEL_LABELS: Record<TvLevel, string> = {
  ver: "Ver e utilizar",
  modificar: "Modificar",
};

const subjectKey = (grant: Pick<TvGrant, "user_id" | "group_id">) => (grant.user_id != null ? `u${grant.user_id}` : `g${grant.group_id}`);

/** Quem pode acessar esta TV: pessoas e grupos, cada um com "ver e utilizar" ou "modificar". So aparece para quem pode
 * modificar a TV. O administrador da plataforma acessa todas as TVs sem precisar estar na lista. */
export default function TvGrantsEditor({ tvId }: { tvId: number }) {
  const { showToast } = useToast();
  const [grants, setGrants] = useState<TvGrant[] | null>(null);
  const [saved, setSaved] = useState("");
  const [people, setPeople] = useState<{ users: TvPerson[]; groups: TvPerson[] } | null>(null);
  const [choice, setChoice] = useState("");
  const [level, setLevel] = useState<TvLevel>("ver");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getTvGrants(tvId), listTvPeople()])
      .then(([loaded, all]) => {
        setGrants(loaded);
        setSaved(JSON.stringify(loaded.map((g) => [subjectKey(g), g.level]).sort()));
        setPeople(all);
      })
      .catch((err) => setError(extractErrorMessage(err) || "Nao foi possivel carregar as permissoes da TV."));
  }, [tvId]);

  const dirty = useMemo(
    () => grants !== null && JSON.stringify(grants.map((g) => [subjectKey(g), g.level]).sort()) !== saved,
    [grants, saved],
  );

  if (error) return <p className="auth-error">{error}</p>;
  if (!grants || !people) return <p className="tv-muted">Carregando as permissões...</p>;

  const taken = new Set(grants.map(subjectKey));
  const freeUsers = people.users.filter((p) => !taken.has(`u${p.id}`));
  const freeGroups = people.groups.filter((p) => !taken.has(`g${p.id}`));

  function add() {
    if (!choice) return;
    const [kind, id] = [choice[0], Number(choice.slice(1))];
    const source = kind === "u" ? people!.users : people!.groups;
    const found = source.find((p) => p.id === id);
    if (!found) return;
    setGrants([
      ...grants!,
      { user_id: kind === "u" ? id : null, group_id: kind === "g" ? id : null, name: found.name, level },
    ]);
    setChoice("");
  }

  async function save() {
    setBusy(true);
    try {
      const result = await replaceTvGrants(
        tvId,
        grants!.map((g) => ({ user_id: g.user_id, group_id: g.group_id, level: g.level })),
      );
      setGrants(result);
      setSaved(JSON.stringify(result.map((g) => [subjectKey(g), g.level]).sort()));
      showToast("Permissões da TV salvas.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar as permissoes.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tv-grants">
      {grants.length === 0 ? (
        <p className="tv-muted">Só o administrador da plataforma acessa esta TV. Adicione pessoas ou grupos abaixo.</p>
      ) : (
        <ul className="tv-grant-list">
          {grants.map((grant, index) => (
            <li key={subjectKey(grant)} className="tv-grant">
              <MenuIcon name={grant.user_id != null ? "person" : "group"} />
              <span className="tv-grant-name">{grant.name}</span>
              <select
                className="input"
                value={grant.level}
                aria-label={`Permissão de ${grant.name}`}
                onChange={(e) => setGrants(grants.map((g, i) => (i === index ? { ...g, level: e.target.value as TvLevel } : g)))}
              >
                {(Object.keys(LEVEL_LABELS) as TvLevel[]).map((key) => (
                  <option key={key} value={key}>
                    {LEVEL_LABELS[key]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGrants(grants.filter((_, i) => i !== index))} aria-label={`Tirar ${grant.name}`}>
                <MenuIcon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tv-grant-add">
        <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Pessoa ou grupo">
          <option value="">Escolha uma pessoa ou grupo</option>
          {freeGroups.length > 0 && (
            <optgroup label="Grupos">
              {freeGroups.map((p) => (
                <option key={`g${p.id}`} value={`g${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {freeUsers.length > 0 && (
            <optgroup label="Pessoas">
              {freeUsers.map((p) => (
                <option key={`u${p.id}`} value={`u${p.id}`}>
                  {p.name}
                  {p.email ? ` (${p.email})` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select className="input" value={level} onChange={(e) => setLevel(e.target.value as TvLevel)} aria-label="Nível da nova permissão">
          {(Object.keys(LEVEL_LABELS) as TvLevel[]).map((key) => (
            <option key={key} value={key}>
              {LEVEL_LABELS[key]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={!choice}>
          Adicionar
        </button>
      </div>
      <p className="tv-muted">
        <strong>Ver e utilizar:</strong> vê a TV e a programação, abre o link, vê o código de acesso e desconecta a TV.{" "}
        <strong>Modificar:</strong> também edita a programação, os tempos, o tempo de conexão, troca o link e exclui a TV.
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
        {busy ? "Salvando..." : "Salvar permissões"}
      </button>
    </div>
  );
}
