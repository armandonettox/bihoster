import type { Group } from "../api/groups";
import type { UserRole } from "../api/workspaces";

export const ACCESS_OPTIONS: { value: UserRole | "none"; label: string }[] = [
  { value: "none", label: "Sem acesso" },
  { value: "viewer", label: "Ver" },
  { value: "editor", label: "Fazer curadoria" },
];

export default function AccessMatrixFields({
  groups,
  values,
  onChange,
}: {
  groups: Group[];
  values: Record<number, UserRole | null>;
  onChange: (groupId: number, value: UserRole | null) => void;
}) {
  const visibleGroups = groups.filter((g) => !g.is_admin_group);

  if (visibleGroups.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <p className="icon-picker-label">Acesso por grupo</p>
      <table className="table">
        <thead>
          <tr>
            <th>Grupo</th>
            <th>Nivel de acesso</th>
          </tr>
        </thead>
        <tbody>
          {visibleGroups.map((g) => (
            <tr key={g.id}>
              <td>
                {g.name} {g.is_default && <span className="badge">padrao</span>}
              </td>
              <td>
                <select
                  className="input"
                  style={{ width: 160, padding: "6px 8px" }}
                  value={values[g.id] || "none"}
                  onChange={(e) => onChange(g.id, e.target.value === "none" ? null : (e.target.value as UserRole))}
                >
                  {ACCESS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
