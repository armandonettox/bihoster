import { useLocation } from "react-router-dom";
import { useChat } from "../context/ChatContext";

/** Item "Chat de IA" do menu lateral. Abre e fecha o painel lateral do chat; a tela cheia (/chat) so se abre
 * pelo botao de tela cheia do painel. So aparece para quem tem a permissao de usar o chat. */
export default function ChatNavLink() {
  const { canUse, panelOpen, setPanelOpen } = useChat();
  const location = useLocation();
  if (!canUse) return null;

  // Na tela cheia o chat ja esta aberto: o item so mostra onde a pessoa esta
  const onChatPage = location.pathname === "/chat";
  const active = onChatPage || panelOpen;

  return (
    <button
      type="button"
      className={`sidebar-home-link sidebar-home-button ${active ? "sidebar-home-link-active" : ""}`}
      aria-pressed={active}
      onClick={() => {
        if (!onChatPage) setPanelOpen(!panelOpen);
      }}
    >
      <span className="sidebar-home-icon material-symbols-outlined">chat</span>
      Chat de IA
    </button>
  );
}
