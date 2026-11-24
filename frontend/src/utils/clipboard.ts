/** Copia um texto para a area de transferencia. Se o navegador nao deixar (pagina sem HTTPS, permissao negada), tenta o
 * jeito antigo com um campo escondido. Levanta erro se nenhum dos dois funcionar. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // cai para o jeito antigo
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Nao foi possivel copiar");
  } finally {
    document.body.removeChild(field);
  }
}
