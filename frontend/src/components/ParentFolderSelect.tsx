import type { Workspace } from "../api/workspaces";
import { useAccess } from "../context/AccessContext";

/** "Dentro de": escolhe a pasta onde a coleção fica. Só lista as pastas em que a pessoa pode criar subpastas, e "nenhuma"
 * (pasta de topo) só se ela pode criar coleções. `excludeIds` tira a própria pasta e as de dentro dela (não dá para
 * fechar um ciclo). O servidor confere tudo de novo. */
export default function ParentFolderSelect({
  workspaces,
  value,
  onChange,
  excludeIds = [],
}: {
  workspaces: Workspace[];
  value: number | null;
  onChange: (next: number | null) => void;
  excludeIds?: number[];
}) {
  const access = useAccess();
  const excluded = new Set(excludeIds);
  const options = workspaces.filter((w) => !excluded.has(w.id) && (access.canIn("colecao.criar-subpasta", w.id) || w.id === value));
  const canTop = access.can("colecao.criar") || value === null;

  // Sem nenhuma pasta onde criar e sem poder criar no topo, o campo so atrapalharia
  if (options.length === 0 && !canTop) return null;
  if (options.length === 0) return null;

  return (
    <label className="field" style={{ marginBottom: 10 }}>
      Dentro de
      <select
        className="input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        {canTop && <option value="">Nenhuma (pasta de topo)</option>}
        {options.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}
