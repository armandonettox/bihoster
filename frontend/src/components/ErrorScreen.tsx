import type { CSSProperties, ReactNode } from "react";

/** O desenho das telas de erro: logo, código, título, mensagem e a ação (botão ou link). É usado pela página 404,
 * pela tela de erro inesperado e pelas prévias da aba Marca, para as três ficarem sempre iguais. */
export default function ErrorScreen({
  logo,
  code,
  title,
  message,
  action,
  preview = false,
  style,
}: {
  logo: ReactNode;
  code: string;
  title: string;
  message: string;
  action: ReactNode;
  /** Prévia dentro da aba Marca: o título não vira h1 (a página já tem o dela) */
  preview?: boolean;
  style?: CSSProperties;
}) {
  const Title = preview ? "div" : "h1";
  return (
    <div className="error-page" style={style}>
      {logo}
      <div className="error-page-code">{code}</div>
      <Title className="error-page-title">{title}</Title>
      <p className="error-page-desc">{message}</p>
      {action}
    </div>
  );
}
