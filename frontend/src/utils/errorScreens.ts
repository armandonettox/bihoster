import type { AppSettings } from "../api/settings";

/** As duas telas de erro: página não encontrada (404) e erro inesperado */
export type ErrorScreenKind = "notFound" | "error";

export interface ErrorScreenTexts {
  title: string;
  message: string;
  button: string;
}

// Os mesmos limites do servidor (schemas/settings.py)
export const ERROR_TITLE_MAX = 80;
export const ERROR_MESSAGE_MAX = 300;
export const ERROR_BUTTON_MAX = 40;

/** O que cada tela mostra quando o admin não personalizou nada (ou quando a marca não carregou) */
export const DEFAULT_ERROR_TEXTS: Record<ErrorScreenKind, ErrorScreenTexts> = {
  notFound: {
    title: "Página não encontrada",
    message: "O endereço que você tentou acessar não existe ou foi removido.",
    button: "Voltar para o início",
  },
  error: {
    title: "Algo deu errado",
    message: "Aconteceu um erro inesperado nesta tela. Você pode tentar voltar para o início.",
    button: "Voltar para o início",
  },
};

/** As duas telas de aviso: fora do horário de acesso e sem acesso a nenhuma coleção */
export type NoticeScreenKind = "outsideHours" | "noAccess";

/** O que cada tela de aviso mostra quando o admin não personalizou nada. Na tela de fora do horário, o horário permitido
 * e quando o acesso volta aparecem sozinhos, junto da mensagem. Na de sem acesso, a mensagem é a de quem não pode criar
 * coleção (quem pode vê o formulário de criar) e o título padrão leva o nome da pessoa ("Bem-vindo, Nome"). */
export const DEFAULT_NOTICE_TEXTS: Record<NoticeScreenKind, ErrorScreenTexts> = {
  outsideHours: {
    title: "Fora do horário de acesso",
    message: "Você não pode usar o sistema neste momento.",
    button: "Tentar novamente",
  },
  noAccess: {
    title: "Bem-vindo",
    message:
      "Você ainda não tem acesso a nenhuma coleção. Peça para um administrador te adicionar a um grupo com acesso: só quem está no grupo Administradores pode criar coleções.",
    button: "Sair",
  },
};

type CustomTexts = Partial<
  Pick<
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
  >
>;

/** Texto personalizado, ou o padrão se estiver vazio ou não for texto. Nunca lança erro: a tela de erro precisa
 * conseguir aparecer mesmo com a marca quebrada. */
function pick(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** O texto que o admin escreveu, ou nulo se não personalizou (vazio ou sem texto) */
export function customText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Os textos de uma tela de aviso: os da marca onde o admin preencheu, o padrão no resto */
export function noticeScreenTexts(kind: NoticeScreenKind, settings: CustomTexts | null | undefined): ErrorScreenTexts {
  const padrao = DEFAULT_NOTICE_TEXTS[kind];
  if (!settings) return padrao;
  if (kind === "outsideHours") {
    return {
      title: pick(settings.outside_hours_title, padrao.title),
      message: pick(settings.outside_hours_message, padrao.message),
      button: pick(settings.outside_hours_button, padrao.button),
    };
  }
  return {
    title: pick(settings.no_access_title, padrao.title),
    message: pick(settings.no_access_message, padrao.message),
    button: pick(settings.no_access_button, padrao.button),
  };
}

/** Os textos de uma tela de erro: os da marca onde o admin preencheu, o padrão no resto */
export function errorScreenTexts(kind: ErrorScreenKind, settings: CustomTexts | null | undefined): ErrorScreenTexts {
  const padrao = DEFAULT_ERROR_TEXTS[kind];
  if (!settings) return padrao;
  if (kind === "notFound") {
    return {
      title: pick(settings.not_found_title, padrao.title),
      message: pick(settings.not_found_message, padrao.message),
      button: pick(settings.not_found_button, padrao.button),
    };
  }
  return {
    title: pick(settings.error_title, padrao.title),
    message: pick(settings.error_message, padrao.message),
    button: pick(settings.error_button, padrao.button),
  };
}
