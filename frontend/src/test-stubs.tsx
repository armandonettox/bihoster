/** Componente de mentira para testes que so precisam saber QUAL tela foi escolhida, sem rede. */
export function tabStub(label: string) {
  return { default: () => <div data-testid="tab-content">{label}</div> };
}
