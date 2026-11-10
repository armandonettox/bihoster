import { useEffect, useState } from "react";

// As frases seguem a ordem do que o motor faz, mas trocam por tempo: o navegador nao sabe em que
// passo o servidor esta. Por isso sao palavras gerais, e a ultima fica ate a resposta chegar.
const PENDING_STEPS = ["Escolhendo o relatorio", "Montando a consulta", "Lendo os dados", "Escrevendo a resposta"];
const PENDING_STEP_MS = 4000;

/** Indicador de "pensando" do chat: frase que muda com o tempo e tres pontinhos animados. */
export default function ChatPending() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setStep((current) => Math.min(current + 1, PENDING_STEPS.length - 1)), PENDING_STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-bubble chat-pending" role="status">
        <span>{PENDING_STEPS[step]}</span>
        <span className="chat-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
