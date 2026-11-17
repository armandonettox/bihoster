import { Component, type ContextType, type ReactNode } from "react";
import { BrandingContext } from "../context/brandingContextObject";
import { errorScreenTexts } from "../utils/errorScreens";
import DefaultBrandLogo from "./DefaultBrandLogo";
import ErrorScreen from "./ErrorScreen";

interface Props {
  children: ReactNode;
  /** Quando esse valor muda (ex: o caminho da rota), o erro e limpo automaticamente --
   * sem isso, um erro passageiro numa tela deixava o app inteiro travado ate reload manual,
   * mesmo depois de navegar pra outro lugar onde o problema nem existe mais. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  // Lê os textos da marca quando o provedor existe. O ErrorBoundary de fora do app roda sem provedor: aí o contexto
  // vem vazio e valem os textos padrão. Nunca exige o provedor, para a tela de erro sempre conseguir aparecer.
  static contextType = BrandingContext;
  declare context: ContextType<typeof BrandingContext>;

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Erro na interface:", error);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      const texts = errorScreenTexts("error", this.context?.settings);
      return (
        <ErrorScreen
          // Sempre a logo padrao: este componente roda quando algo ja quebrou, entao nao depende da logo da marca
          // (que poderia ser justamente a causa do erro). So os textos podem ser personalizados, e voltam ao padrao
          // se a marca nao tiver carregado.
          logo={<DefaultBrandLogo className="error-page-logo" />}
          code="Ops"
          title={texts.title}
          message={texts.message}
          action={
            <button className="btn btn-primary" onClick={this.handleReload}>
              {texts.button}
            </button>
          }
        />
      );
    }
    return this.props.children;
  }
}
