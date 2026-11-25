import type { Face } from "../../api/workspaceCatalog";

const COLORS = ["#1e3a6b", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4d7c0f"];

function colorOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Rosto de uma pessoa (foto ou iniciais) ou de um grupo (iniciais num quadrado arredondado). */
export function Avatar({ name, picture, group = false, title }: { name: string; picture?: string | null; group?: boolean; title?: string }) {
  return (
    <span className="rpt-avatar" title={title ?? name} style={{ background: colorOf(name), borderRadius: group ? 8 : "50%" }} aria-hidden="true">
      {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

/** Pilha de rostos com a contagem total: "quem tem acesso" numa linha da tabela. */
export function AvatarStack({ people, count }: { people: Face[]; count: number }) {
  if (count === 0) return <span className="rpt-muted">Ninguém</span>;
  const extra = count - people.length;
  return (
    <span className="rpt-stack" aria-label={`${count} ${count === 1 ? "pessoa ou grupo" : "pessoas e grupos"} com acesso`}>
      {people.map((person) => (
        <Avatar key={`${person.kind}:${person.name}`} name={person.name} picture={person.picture_url} group={person.kind === "group"} />
      ))}
      <span className="rpt-count">{extra > 0 ? `+${extra}` : count}</span>
    </span>
  );
}
