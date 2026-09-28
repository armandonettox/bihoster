/** Wrapper de localStorage que nao quebra em navegacao anonima ou perfis com storage bloqueado --
 * nesses casos localStorage.getItem/setItem lanca excecao em vez de simplesmente nao persistir. */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Sem problema nao persistir a preferencia -- a sessao continua funcionando normalmente.
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Idem.
    }
  },
};
