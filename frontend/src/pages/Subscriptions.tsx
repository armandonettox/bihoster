import { Navigate } from "react-router-dom";
import PageLoading from "../components/PageLoading";
import { useAccess } from "../context/AccessContext";
import { SUBSCRIPTIONS_AREA_KEYS } from "../utils/adminTabs";
import SubscriptionsTab from "./settings/SubscriptionsTab";

/** Assinaturas: a visão de todas as assinaturas de e-mail do sistema. Página própria, fora da Administração. */
export default function Subscriptions() {
  const access = useAccess();

  // Sem saber o que a pessoa pode, nao da pra decidir se ela fica ou vai embora
  if (access.loading) return <PageLoading />;
  if (!access.canAny(...SUBSCRIPTIONS_AREA_KEYS)) return <Navigate to="/" replace />;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Assinaturas</h1>
        <p>Todos os envios recorrentes de relatório por e-mail do sistema.</p>
      </div>
      <SubscriptionsTab />
    </div>
  );
}
