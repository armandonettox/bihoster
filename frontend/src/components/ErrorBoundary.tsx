import { Component, type ReactNode } from "react";

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
      return (
        <div className="error-page">
          <div className="error-page-code">Ops</div>
          <h1 className="error-page-title">Algo deu errado</h1>
          <p className="error-page-desc">
            Aconteceu um erro inesperado nesta tela. Voce pode tentar voltar para o inicio.
          </p>
          <button className="btn btn-primary" onClick={this.handleReload}>
            Voltar para o inicio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
