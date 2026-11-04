/** Nome do status de atualizacao do Power BI em portugues. Sem status (relatorio sem dataset ou
 * historico indisponivel): "-". Um status que o app ainda nao conhece aparece como veio. */
export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "Completed":
      return "Concluida";
    case "Failed":
      return "Falhou";
    case "Unknown":
      return "Em andamento";
    case "Disabled":
      return "Desabilitada";
    case "Cancelled":
      return "Cancelada";
    case null:
    case undefined:
    case "":
      return "-";
    default:
      return status;
  }
}
