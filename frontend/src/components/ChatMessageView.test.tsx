import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChatMessageView from "./ChatMessageView";

describe("ChatMessageView - imagem da pagina", () => {
  it("avisa que a imagem da pagina foi enviada ao provedor de IA", () => {
    render(<ChatMessageView item={{ key: "a", role: "assistant", content: "O total foi 99.", usedImage: true }} />);

    expect(screen.getByText("A imagem da pagina aberta foi enviada ao provedor de IA nesta pergunta.")).toBeTruthy();
  });

  it("sem imagem nao mostra o aviso", () => {
    render(<ChatMessageView item={{ key: "a", role: "assistant", content: "O total foi 99.", usedImage: false }} />);

    expect(screen.queryByText(/imagem da pagina aberta/)).toBeNull();
  });

  it("o aviso de tabela do historico continua so onde fazia sentido", () => {
    render(
      <ChatMessageView
        item={{ key: "b", role: "assistant", content: "ok", dax: "EVALUATE x", fromHistory: true }}
      />,
    );

    expect(screen.getByText(/A tabela nao fica guardada no historico/)).toBeTruthy();
  });
});
