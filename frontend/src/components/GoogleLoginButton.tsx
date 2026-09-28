import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

export default function GoogleLoginButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (idToken: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential: string }) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
    }

    if (window.google) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = render;
      // Sem isso, um bloqueador de anuncios ou rede que bloqueia o dominio do Google
      // deixava esse espaco em branco pra sempre, sem nenhuma pista pro usuario.
      script.onerror = () => {
        if (!cancelled) setLoadFailed(true);
      };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
    };
  }, [clientId, onCredential]);

  if (loadFailed) {
    return (
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
        Nao foi possivel carregar o login do Google (verifique bloqueadores/rede). Use email e senha.
      </p>
    );
  }

  return <div ref={buttonRef} />;
}
