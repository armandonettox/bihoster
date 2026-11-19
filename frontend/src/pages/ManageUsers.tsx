import { Navigate } from "react-router-dom";
import PageLoading from "../components/PageLoading";
import { useAccess } from "../context/AccessContext";
import UsersPanel from "./users/UsersPanel";

/** Gerenciar usuários: pessoas, grupos e permissões num lugar só, fora da Administração. Quem pode ver os grupos também
 * pode ver os membros (o catálogo exige), então basta poder ver os membros para abrir a página; a visão por grupo e cada
 * ação aparecem só para quem tem a permissão delas. */
export default function ManageUsers() {
  const access = useAccess();

  // Sem saber o que a pessoa pode, nao da pra decidir se ela fica ou vai embora
  if (access.loading) return <PageLoading />;
  if (!access.can("membros.ver")) return <Navigate to="/" replace />;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Gerenciar usuários</h1>
        <p>Pessoas, grupos e permissões num lugar só: quem está no sistema, em quais grupos e o que cada um pode fazer.</p>
      </div>
      <UsersPanel />
    </div>
  );
}
