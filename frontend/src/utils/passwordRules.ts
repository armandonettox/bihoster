export const MIN_PASSWORD_LENGTH = 8;
// O bcrypt so le os 72 primeiros bytes; o servidor recusa mais que isso
export const MAX_PASSWORD_BYTES = 72;

/** Mensagem de erro de uma senha nova que nao serve, ou null se serve. Espelha a regra do servidor. */
export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (new TextEncoder().encode(next).length > MAX_PASSWORD_BYTES) {
    return `A nova senha e longa demais (maximo ${MAX_PASSWORD_BYTES} bytes).`;
  }
  if (next === current) return "A nova senha deve ser diferente da atual.";
  if (next !== confirm) return "A confirmacao nao e igual a nova senha.";
  return null;
}
