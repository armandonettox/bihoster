import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, validateNewPassword } from "./passwordRules";

describe("validateNewPassword", () => {
  it("aceita uma senha valida e diferente da atual", () => {
    expect(validateNewPassword("SenhaAntiga1", "SenhaNova123", "SenhaNova123")).toBeNull();
  });

  it("recusa menos que o minimo de caracteres", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword("antiga-senha", short, short)).toMatch(/pelo menos 8/);
    expect(validateNewPassword("antiga-senha", "a".repeat(MIN_PASSWORD_LENGTH), "a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("recusa mais que 72 bytes, contando bytes e nao caracteres", () => {
    const longAscii = "a".repeat(MAX_PASSWORD_BYTES + 1);
    expect(validateNewPassword("antiga-senha", longAscii, longAscii)).toMatch(/longa demais/);
    // 40 letras acentuadas = 40 caracteres, mas 80 bytes em UTF-8
    const accented = "ã".repeat(40);
    expect(accented.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(validateNewPassword("antiga-senha", accented, accented)).toMatch(/longa demais/);
  });

  it("aceita exatamente 72 bytes", () => {
    const exact = "a".repeat(MAX_PASSWORD_BYTES);
    expect(validateNewPassword("antiga-senha", exact, exact)).toBeNull();
  });

  it("recusa senha igual a atual", () => {
    expect(validateNewPassword("MesmaSenha1", "MesmaSenha1", "MesmaSenha1")).toMatch(/diferente da atual/);
  });

  it("recusa confirmacao diferente", () => {
    expect(validateNewPassword("SenhaAntiga1", "SenhaNova123", "SenhaNova124")).toMatch(/confirmacao/);
  });
});
