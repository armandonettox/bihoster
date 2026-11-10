import type { ChatReport, ChatTable as ChatTableData } from "../api/aiChat";
import ChatTable from "./ChatTable";

export interface ChatItem {
  key: string;
  role: "user" | "assistant";
  content: string;
  report?: ChatReport | null;
  dax?: string | null;
  table?: ChatTableData | null;
  /** Falha ao responder: aparece como aviso e nao fica no historico */
  error?: boolean;
  /** Veio do historico: la a tabela nao existe, so o texto e a consulta */
  fromHistory?: boolean;
  /** A imagem da pagina aberta foi enviada ao provedor de IA nesta pergunta */
  usedImage?: boolean;
}

/** Uma mensagem da conversa. O texto entra como texto (nada de HTML), e a consulta DAX fica
 * recolhida: quem quiser conferir de onde veio o numero abre. */
export default function ChatMessageView({ item }: { item: ChatItem }) {
  const className = `chat-message chat-message-${item.role}${item.error ? " chat-message-error" : ""}`;
  return (
    <div className={className} role={item.error ? "alert" : undefined}>
      <div className="chat-bubble">
        <p className="chat-text">{item.content}</p>
        {item.report && (
          <p className="chat-report">
            Relatorio: <strong>{item.report.name}</strong>
          </p>
        )}
        {item.table && <ChatTable table={item.table} />}
        {item.dax && (
          <details className="chat-dax">
            <summary>Ver consulta DAX</summary>
            <pre>{item.dax}</pre>
          </details>
        )}
        {item.usedImage && (
          <p className="chat-hint">A imagem da pagina aberta foi enviada ao provedor de IA nesta pergunta.</p>
        )}
        {item.fromHistory && item.dax && !item.table && (
          <p className="chat-hint">
            A tabela nao fica guardada no historico. A consulta acima mostra como o numero foi obtido.
          </p>
        )}
      </div>
    </div>
  );
}
