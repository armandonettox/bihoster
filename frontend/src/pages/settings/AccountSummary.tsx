import type { User } from "../../api/auth";

function formatDate(iso: string | null | undefined, withTime: boolean): string | null {
  if (!iso) return null;
  // O backend manda a data em UTC, sem sufixo quando vem do SQLite
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return withTime
    ? date.toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })
    : date.toLocaleDateString("pt-BR", { dateStyle: "long" });
}

function languageName(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    const name = new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(locale);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
  } catch {
    return locale;
  }
}

/** Cartao com o resumo da conta: desde quando existe, tipo de acesso, grupos e ultimo login. */
export default function AccountSummary({ user }: { user: User }) {
  const viaGoogle = user.login_provider === "google";
  const rows: { label: string; value: string }[] = [];

  const memberSince = formatDate(user.created_at, false);
  if (memberSince) rows.push({ label: "Membro desde", value: memberSince });

  rows.push({ label: "Tipo de acesso", value: user.is_platform_admin ? "Administrador da plataforma" : "Usuario" });

  if (user.groups && user.groups.length > 0) rows.push({ label: "Grupos", value: user.groups.join(", ") });

  const lastLogin = formatDate(user.last_login_at, true);
  if (lastLogin) rows.push({ label: "Ultimo login", value: lastLogin });

  if (viaGoogle) {
    if (user.google_domain) {
      rows.push({
        label: "Dominio Google",
        value: user.google_workspace ? `${user.google_domain} (Google Workspace)` : user.google_domain,
      });
    }
    const language = languageName(user.google_locale);
    if (language) rows.push({ label: "Idioma da conta Google", value: language });
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Resumo da conta</h2>
      <dl className="account-summary">
        {rows.map((row) => (
          <div key={row.label} className="account-summary-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
