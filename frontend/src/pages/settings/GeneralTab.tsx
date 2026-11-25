import { useEffect, useState } from "react";
import * as workspacesApi from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
import { useBranding } from "../../context/BrandingContext";
import { getUtcOffsetLabel } from "../../utils/datetime";
import PowerBiConnectionsSection from "../../components/PowerBiConnectionsSection";
import SettingsRowList, { type SettingsRow } from "../../components/SettingsRowList";
import GeneralAppModal from "./general/GeneralAppModal";
import GeneralHomeModal from "./general/GeneralHomeModal";
import GeneralHttpsModal from "./general/GeneralHttpsModal";
import GeneralRlsOutputModal from "./general/GeneralRlsOutputModal";

type Editing = "app" | "https" | "home" | "rls" | null;

export default function GeneralTab() {
  const { settings } = useBranding();
  const [editing, setEditing] = useState<Editing>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    workspacesApi
      .listAllWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([])); // sem a lista o seletor da Homepage fica só com "Nenhuma"
  }, []);

  const close = () => setEditing(null);
  const timezone = settings?.timezone || "America/Sao_Paulo";
  const homeName = workspaces.find((w) => w.id === settings?.default_workspace_id)?.name;
  const httpsOn = settings?.force_https || false;

  const rows: SettingsRow[] = [
    {
      key: "app",
      label: "Dados do aplicativo",
      description: "Nome do site, endereço, e-mail de suporte e fuso horário.",
      summary: settings ? `${settings.company_name || "Sem nome"} · ${getUtcOffsetLabel(timezone)}` : undefined,
      status: settings?.site_url ? "Com endereço" : "Sem endereço",
      highlight: Boolean(settings?.site_url),
      onEdit: () => setEditing("app"),
      disabled: settings === null,
    },
    {
      key: "https",
      label: "Acesso seguro (HTTPS)",
      description: "Leva quem abrir o portal por http para https.",
      status: httpsOn ? "Ligado" : "Desligado",
      highlight: httpsOn,
      onEdit: () => setEditing("https"),
      disabled: settings === null,
    },
    {
      key: "home",
      label: "Homepage",
      description: "A coleção que abre primeiro ao entrar e o atalho para quem só tem uma coleção.",
      summary: settings?.default_workspace_id ? `Coleção: ${homeName ?? "carregando..."}` : "Tela padrão",
      status: settings?.default_workspace_id ? "Definida" : "Padrão",
      highlight: Boolean(settings?.default_workspace_id),
      onEdit: () => setEditing("home"),
      disabled: settings === null,
    },
    {
      key: "rls",
      label: "Saída de relatório com RLS",
      description: "Deixa relatórios com segurança por linha saírem por e-mail, arquivo e Modo TV, sempre com a função de quem recebe.",
      status: settings?.rls_output_enabled ? "Ligado" : "Desligado",
      highlight: Boolean(settings?.rls_output_enabled),
      onEdit: () => setEditing("rls"),
      disabled: settings === null,
    },
  ];

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Configuração do aplicativo</h2>
        <p className="settings-section-desc">Informações gerais desta instância do sistema. Abra uma parte para ajustar e salvar.</p>
        <SettingsRowList rows={rows} />
      </div>

      {settings && editing === "app" && <GeneralAppModal settings={settings} onClose={close} />}
      {settings && editing === "https" && <GeneralHttpsModal settings={settings} onClose={close} />}
      {settings && editing === "rls" && <GeneralRlsOutputModal settings={settings} onClose={close} />}
      {settings && editing === "home" && <GeneralHomeModal settings={settings} workspaces={workspaces} onClose={close} />}

      <PowerBiConnectionsSection />
    </div>
  );
}
