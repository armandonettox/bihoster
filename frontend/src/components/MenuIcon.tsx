/** Ícone de uma opção de menu (o menu dos 3 pontinhos): mesmo tamanho e padrão dos outros menus do app, escondido do
 * leitor de tela porque a opção já tem o próprio texto. Recebe o nome do ícone do Material Symbols. */
export default function MenuIcon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden="true">
      {name}
    </span>
  );
}
