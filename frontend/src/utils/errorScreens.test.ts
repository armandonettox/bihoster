import { describe, expect, it } from "vitest";
import { DEFAULT_ERROR_TEXTS, ERROR_BUTTON_MAX, ERROR_MESSAGE_MAX, ERROR_TITLE_MAX, errorScreenTexts } from "./errorScreens";

describe("errorScreenTexts", () => {
  it("sem marca carregada devolve os textos padrão das duas telas", () => {
    expect(errorScreenTexts("notFound", null)).toEqual(DEFAULT_ERROR_TEXTS.notFound);
    expect(errorScreenTexts("error", undefined)).toEqual(DEFAULT_ERROR_TEXTS.error);
  });

  it("os textos padrão são os que a interface sempre mostrou, agora com acento", () => {
    expect(DEFAULT_ERROR_TEXTS.notFound.title).toBe("Página não encontrada");
    expect(DEFAULT_ERROR_TEXTS.error.title).toBe("Algo deu errado");
    expect(DEFAULT_ERROR_TEXTS.notFound.button).toBe("Voltar para o início");
  });

  it("usa o texto personalizado onde o admin preencheu e o padrão no resto", () => {
    const textos = errorScreenTexts("notFound", { not_found_title: "Essa página sumiu", not_found_message: null });

    expect(textos.title).toBe("Essa página sumiu");
    expect(textos.message).toBe(DEFAULT_ERROR_TEXTS.notFound.message);
    expect(textos.button).toBe(DEFAULT_ERROR_TEXTS.notFound.button);
  });

  it("cada tela lê só os seus campos: personalizar a 404 não muda a de erro", () => {
    const marca = { not_found_title: "Sumiu", error_button: "Tentar de novo" };

    expect(errorScreenTexts("notFound", marca).title).toBe("Sumiu");
    expect(errorScreenTexts("notFound", marca).button).toBe(DEFAULT_ERROR_TEXTS.notFound.button);
    expect(errorScreenTexts("error", marca).title).toBe(DEFAULT_ERROR_TEXTS.error.title);
    expect(errorScreenTexts("error", marca).button).toBe("Tentar de novo");
  });

  it("texto vazio ou só com espaços vale como não preenchido, e espaços nas pontas são tirados", () => {
    const textos = errorScreenTexts("error", { error_title: "   ", error_message: "", error_button: "  Voltar  " });

    expect(textos.title).toBe(DEFAULT_ERROR_TEXTS.error.title);
    expect(textos.message).toBe(DEFAULT_ERROR_TEXTS.error.message);
    expect(textos.button).toBe("Voltar");
  });

  it("valor que não é texto (marca quebrada) nunca derruba a tela: cai no padrão", () => {
    const quebrada = { error_title: 42, error_message: { a: 1 }, error_button: [] } as unknown as Parameters<typeof errorScreenTexts>[1];

    expect(errorScreenTexts("error", quebrada)).toEqual(DEFAULT_ERROR_TEXTS.error);
  });

  it("os limites são os mesmos do servidor", () => {
    expect([ERROR_TITLE_MAX, ERROR_MESSAGE_MAX, ERROR_BUTTON_MAX]).toEqual([80, 300, 40]);
  });
});
