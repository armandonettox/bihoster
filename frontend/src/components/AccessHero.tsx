export interface HeroStat {
  label: string;
  value: string;
}

/** O cabeçalho da janela de permissões, de uma pessoa ou de um grupo: iniciais, nome, uma linha de apoio, etiquetas
 * (os grupos da pessoa ou os membros do grupo) e os números-resumo. Só apresenta; quem edita é o formulário abaixo. */
export default function AccessHero({
  initials,
  name,
  subtitle,
  tags = [],
  tagsLabel,
  stats,
}: {
  initials: string;
  name: string;
  subtitle?: string;
  tags?: string[];
  /** Nome da lista de etiquetas, para o leitor de tela ("Grupos", "Membros") */
  tagsLabel?: string;
  stats: HeroStat[];
}) {
  return (
    <section className="access-hero" aria-label={`Resumo de ${name}`}>
      <div className="access-hero-top">
        <div className="user-avatar access-hero-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="access-hero-id">
          <strong>{name}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>

      {tags.length > 0 && (
        <ul className="access-hero-tags" aria-label={tagsLabel}>
          {tags.map((tag) => (
            <li key={tag} className="access-hero-tag">
              {tag}
            </li>
          ))}
        </ul>
      )}

      <dl className="access-hero-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="access-hero-stat">
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
