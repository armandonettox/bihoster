export type AdminTab = "general" | "brand" | "auth" | "email" | "ai" | "updates" | "cache";

/** As abas da Administracao e os itens que mostram cada uma: aparece para quem tem ao menos um deles. A aba de IA aparece
 * com qualquer item de gerencia da IA. O servidor protege cada rota de qualquer jeito; aqui e so o que a pessoa ve. */
export const ADMIN_TABS: { key: AdminTab; label: string; keys: string[] }[] = [
  { key: "general", label: "Geral", keys: ["sistema.geral"] },
  { key: "brand", label: "Marca", keys: ["sistema.marca"] },
  { key: "auth", label: "Autenticação", keys: ["sistema.autenticacao"] },
  { key: "email", label: "E-mail", keys: ["sistema.email"] },
  { key: "ai", label: "IA", keys: ["ia.chaves", "ia.modelos", "ia.bloqueios", "ia.registro", "ia.consumo"] },
  { key: "updates", label: "Atualizações", keys: ["sistema.versao"] },
  { key: "cache", label: "Cache", keys: ["sistema.cache"] },
];

/** Os itens que abrem Gerenciar usuarios (pessoas, grupos e permissoes), que fica fora da Administracao */
export const USERS_AREA_KEYS: string[] = ["membros.ver", "grupos.ver"];

/** O item que abre a pagina de Colecoes (a lista de todas as colecoes), que fica fora da Administracao */
export const COLLECTIONS_AREA_KEYS: string[] = ["colecao.todas"];

/** O item que abre a pagina de Assinaturas (a visao de todas as assinaturas), que fica fora da Administracao */
export const SUBSCRIPTIONS_AREA_KEYS: string[] = ["assinatura.todas"];

/** O item que abre a pagina de Alertas (a visao de todos os alertas), que fica fora da Administracao */
export const ALERTS_AREA_KEYS: string[] = ["alerta.todas"];

/** Os itens que abrem a pagina do Catalogo (lista de relatorios e de modelos importados do Power BI), fora da Administracao */
export const CATALOG_AREA_KEYS: string[] = ["relatorio.catalogo", "modelo.catalogo", "modelo.seguranca"];

/** Os itens que abrem a pagina de Acessos aos relatorios (quem pode o que em cada relatorio), fora da Administracao */
export const REPORT_ACCESS_AREA_KEYS: string[] = ["permissoes.editar", "membros.ver", "grupos.ver"];

/** Todos os itens que abrem alguma aba da Administracao (para saber se a pessoa tem algo a administrar) */
export const ADMIN_AREA_KEYS: string[] = ADMIN_TABS.flatMap((tab) => tab.keys);
