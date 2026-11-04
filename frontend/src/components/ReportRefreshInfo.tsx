import type { RefreshInfo } from "../api/reports";
import { formatDateTime } from "../utils/datetime";

/** Mostra a ultima e a proxima atualizacao do relatorio. Recebe o dado pronto: a tela da colecao
 * busca tudo de uma vez, em vez de cada card fazer a propria requisicao. */
export default function ReportRefreshInfo({ info }: { info?: RefreshInfo | null }) {
  if (!info || (!info.last_refresh && !info.next_refresh)) return null;

  return (
    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
      {info.last_refresh && <>Ultima atualizacao: {formatDateTime(info.last_refresh)}</>}
      {info.last_refresh && info.next_refresh && " · "}
      {info.next_refresh && <>Proxima: {formatDateTime(info.next_refresh)}</>}
    </span>
  );
}
