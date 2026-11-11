import AccountTab from "./settings/AccountTab";

/** Pagina propria da conta da pessoa (nome e senha), separada das configuracoes de administracao. */
export default function Account() {
  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Minha conta</h1>
        <p>Gerencie o seu nome e a sua senha.</p>
      </div>
      <AccountTab />
    </div>
  );
}
