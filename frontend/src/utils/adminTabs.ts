export type AdminTab = "general" | "collections" | "brand" | "auth" | "email" | "ai" | "subscriptions" | "updates" | "cache";

/** As abas da Administracao e os itens que mostram cada uma: aparece para quem tem ao menos um deles. A aba de IA aparece
 * com qualquer item de gerencia da IA. O servidor protege cada rota de qualquer jeito; aqui e so o que a pessoa ve. */
export const ADMIN_TABS: { key: AdminTab; label: string; keys: string[] }[] = [
  { key: "general", label: "Geral", keys: ["sistema.geral"] },
  { key: "collections", label: "Coleções", keys: ["colecao.todas"] },
  { key: "brand", label: "Marca", keys: ["sistema.marca"] },
  { key: "auth", label: "Autenticacao", keys: ["sistema.autenticacao"] },
  { key: "email", label: "E-mail", keys: ["sistema.email"] },
  { key: "ai", label: "IA", keys: ["ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo"] },
  { key: "subscriptions", label: "Assinaturas", keys: ["assinatura.todas"] },
  { key: "updates", label: "Atualizacoes", keys: ["sistema.versao"] },
  { key: "cache", label: "Cache", keys: ["sistema.cache"] },
];

/** Os itens que abrem Gerenciar usuarios (pessoas, grupos e permissoes), que fica fora da Administracao */
export const USERS_AREA_KEYS: string[] = ["membros.ver", "grupos.ver"];

/** Todos os itens que abrem alguma aba da Administracao (para saber se a pessoa tem algo a administrar) */
export const ADMIN_AREA_KEYS: string[] = ADMIN_TABS.flatMap((tab) => tab.keys);
