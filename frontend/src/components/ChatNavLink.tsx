import { Link, useLocation } from "react-router-dom";
import { useAiAccess } from "../hooks/useAiAccess";

/** Item "Chat de IA" do menu lateral. So aparece para quem tem a permissao de usar o chat. */
export default function ChatNavLink() {
  const { canUse } = useAiAccess();
  const location = useLocation();
  if (!canUse) return null;

  return (
    <Link
      to="/chat"
      className={`sidebar-home-link ${location.pathname === "/chat" ? "sidebar-home-link-active" : ""}`}
    >
      <span className="sidebar-home-icon material-symbols-outlined">chat</span>
      Chat de IA
    </Link>
  );
}
