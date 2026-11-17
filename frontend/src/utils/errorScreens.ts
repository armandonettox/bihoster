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

type CustomTexts = Partial<
  Pick<
    AppSettings,
    "not_found_title" | "not_found_message" | "not_found_button" | "error_title" | "error_message" | "error_button"
  >
>;

/** Texto personalizado, ou o padrão se estiver vazio ou não for texto. Nunca lança erro: a tela de erro precisa
 * conseguir aparecer mesmo com a marca quebrada. */
function pick(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
