import { Navigate } from "react-router-dom";
import PageLoading from "../components/PageLoading";
import { useAccess } from "../context/AccessContext";
import { ALERTS_AREA_KEYS } from "../utils/adminTabs";
import AlertsTab from "./settings/AlertsTab";

/** Alertas: todos os alertas por e-mail do sistema, para ver, criar e editar. Página própria, fora da Administração. */
export default function Alerts() {
  const access = useAccess();

  // Sem saber o que a pessoa pode, nao da pra decidir se ela fica ou vai embora
  if (access.loading) return <PageLoading />;
  if (!access.canAny(...ALERTS_AREA_KEYS)) return <Navigate to="/" replace />;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Alertas</h1>
        <p>Todos os alertas de medidas dos relatórios, com aviso por e-mail.</p>
      </div>
      <AlertsTab />
    </div>
  );
}
