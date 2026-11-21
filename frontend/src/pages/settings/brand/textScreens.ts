import type { AppSettings } from "../../../api/settings";
import { DEFAULT_ERROR_TEXTS, DEFAULT_NOTICE_TEXTS, type ErrorScreenTexts } from "../../../utils/errorScreens";

/** Os campos de texto da marca que guardam o título, a mensagem e o botão de uma tela */
export type TextField = keyof Pick<
  AppSettings,
  | "not_found_title"
  | "not_found_message"
  | "not_found_button"
  | "error_title"
  | "error_message"
  | "error_button"
  | "outside_hours_title"
  | "outside_hours_message"
  | "outside_hours_button"
  | "no_access_title"
  | "no_access_message"
  | "no_access_button"
>;

export type TextScreenId = "notFound" | "error" | "outsideHours" | "noAccess";

export interface TextScreenDef {
  id: TextScreenId;
  /** Nome da linha na lista e título da janela */
  label: string;
  /** Uma frase na lista, dizendo quando a pessoa vê essa tela */
  description: string;
  /** "error" usa a prévia das telas de erro; "notice", a das telas de aviso */
  family: "error" | "notice";
  fields: { title: TextField; message: TextField; button: TextField };
  defaults: ErrorScreenTexts;
  /** Sugestão do campo Título, quando o padrão não é um texto fixo */
  titlePlaceholder?: string;
  /** Explicação que aparece abaixo dos campos */
  note?: string;
  previewNote: string;
}

export const TEXT_SCREENS: TextScreenDef[] = [
  {
    id: "notFound",
    label: "Página não encontrada",
    description: "Aparece quando o endereço acessado não existe ou foi removido (erro 404).",
    family: "error",
    fields: { title: "not_found_title", message: "not_found_message", button: "not_found_button" },
    defaults: DEFAULT_ERROR_TEXTS.notFound,
    previewNote: "Usa o logo e as cores da marca.",
  },
  {
    id: "error",
    label: "Algo deu errado",
    description: "Aparece quando acontece um erro inesperado numa tela.",
    family: "error",
    fields: { title: "error_title", message: "error_message", button: "error_button" },
    defaults: DEFAULT_ERROR_TEXTS.error,
    previewNote: "Usa o logo da marca; se a imagem não carregar, mostra o logo padrão.",
  },
  {
    id: "outsideHours",
    label: "Fora do horário de acesso",
    description: "Aparece para quem tenta entrar fora do horário permitido ao seu grupo.",
    family: "notice",
    fields: { title: "outside_hours_title", message: "outside_hours_message", button: "outside_hours_button" },
    defaults: DEFAULT_NOTICE_TEXTS.outsideHours,
    note: "Sem mensagem sua, a tela diz quando o acesso volta. Com mensagem sua, ela vem primeiro e a linha de quando o acesso volta continua logo abaixo. O horário permitido e o pedido de mais tempo aparecem sempre.",
    previewNote: "Usa o logo e as cores da marca.",
  },
  {
    id: "noAccess",
    label: "Sem acesso a nenhuma coleção",
    description: "Aparece para quem entrou, mas ainda não tem acesso a nenhuma coleção.",
    family: "notice",
    fields: { title: "no_access_title", message: "no_access_message", button: "no_access_button" },
    defaults: DEFAULT_NOTICE_TEXTS.noAccess,
    titlePlaceholder: "Bem-vindo, e o nome da pessoa",
    note: "A mensagem vale para quem não pode criar coleção. Quem pode criar vê o formulário de criar, que não muda. O botão é o de sair da conta.",
    previewNote: "Mostra o texto de quem não pode criar coleção.",
  },
];

/** O texto salvo de um campo, ou vazio se a marca não personalizou (vale o padrão) */
export function savedText(settings: AppSettings | null, field: TextField): string {
  return settings?.[field] ?? "";
}

/** A tela tem algum texto personalizado? */
export function isTextScreenCustomized(settings: AppSettings | null, screen: TextScreenDef): boolean {
  return [screen.fields.title, screen.fields.message, screen.fields.button].some((field) => savedText(settings, field).trim() !== "");
}
