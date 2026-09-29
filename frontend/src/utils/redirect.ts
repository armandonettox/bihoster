/** Valida o destino pos-login vindo da URL (?next=). Aceita so caminho interno do proprio app:
 * comeca com uma unica barra e nao aponta pra tela de login. Qualquer outra coisa (URL externa,
 * "//dominio", "javascript:") cai no padrao "/", evitando open redirect. */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw === "/login" || raw.startsWith("/login?")) return "/";
  return raw;
}

/** Monta a URL de login guardando a pagina que o usuario tentava abrir. */
export function loginUrlFor(pathWithSearch: string): string {
  if (!pathWithSearch || pathWithSearch === "/" || pathWithSearch.startsWith("/login")) return "/login";
  return `/login?next=${encodeURIComponent(pathWithSearch)}`;
}
