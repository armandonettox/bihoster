import { Navigate } from "react-router-dom";
import PageLoading from "../components/PageLoading";
import { useAccess } from "../context/AccessContext";
import { COLLECTIONS_AREA_KEYS } from "../utils/adminTabs";
import CollectionsTab from "./settings/CollectionsTab";

/** Coleções: a lista de todas as coleções do sistema, com editar e excluir. Página própria, fora da Administração. */
export default function Collections() {
  const access = useAccess();

  // Sem saber o que a pessoa pode, nao da pra decidir se ela fica ou vai embora
  if (access.loading) return <PageLoading />;
  if (!access.canAny(...COLLECTIONS_AREA_KEYS)) return <Navigate to="/" replace />;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Coleções</h1>
        <p>Todas as coleções do sistema: nome, descrição, ícone e cor.</p>
      </div>
      <CollectionsTab />
    </div>
  );
}
