import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useChat } from "../context/ChatContext";
import ChatMessageView from "./ChatMessageView";

const MAX_MESSAGE_CHARS = 4000;

/** Mensagens e caixa de pergunta da conversa atual. Usado na pagina /chat e no painel lateral, que
 * mostram a mesma conversa (o estado fica no ChatContext). Deve ficar dentro de um container flex em coluna. */
export default function ChatThread() {
  const { items, input, setInput, sending, sendMessage } = useChat();
  const messagesRef = useRef<HTMLDivElement>(null);

  // Mantem a ultima mensagem a vista
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, sending]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <>
      <div className="chat-messages" ref={messagesRef} aria-live="polite">
        {items.length === 0 && !sending && (
          <div className="chat-empty">
            <h2>Pergunte sobre os dados dos seus relatorios</h2>
            <p>
              Eu respondo so com base nos relatorios que voce pode ver. Cada resposta mostra de qual relatorio veio e a
              consulta usada. Relatorios com seguranca por linha (RLS) ainda nao sao consultados.
            </p>
          </div>
        )}
        {items.map((item) => (
          <ChatMessageView key={item.key} item={item} />
        ))}
        {sending && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-bubble chat-pending">Pensando...</div>
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          className="input chat-input"
          aria-label="Sua pergunta"
          rows={2}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder="Escreva sua pergunta. Enter envia, Shift+Enter quebra a linha."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
          Enviar
        </button>
      </form>
    </>
  );
}
