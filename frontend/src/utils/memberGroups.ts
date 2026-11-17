export interface GroupLike {
  name: string;
  is_default: boolean;
}

export interface GroupSummary {
  /** O nome que aparece no quadrado */
  label: string;
  /** Quantos outros grupos existem além do mostrado (vira o "+N") */
  extra: number;
  /** Todos os grupos, para a dica ao passar o cursor (o padrão também entra aqui) */
  title: string;
  /** Sem nenhum grupo "de verdade" para mostrar: o quadrado fica em cinza */
  muted: boolean;
}

/** O que o quadrado de grupos de uma pessoa mostra.
 *
 * O grupo padrão ("Todos os usuários") é de todo mundo, então não diz nada sobre a pessoa: quando ela tem outro
 * grupo, só ele aparece (com "+N" se forem vários). O padrão só aparece, em cinza, quando é o único. */
export function summarizeGroups(groups: GroupLike[]): GroupSummary {
  if (groups.length === 0) return { label: "Nenhum grupo", extra: 0, title: "Nenhum grupo", muted: true };

  const title = groups.map((group) => group.name).join(", ");
  const others = groups.filter((group) => !group.is_default);
  if (others.length === 0) return { label: groups[0].name, extra: 0, title, muted: true };
  return { label: others[0].name, extra: others.length - 1, title, muted: false };
}
