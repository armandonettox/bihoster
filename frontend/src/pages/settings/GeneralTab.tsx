import { useEffect, useState, type FormEvent } from "react";
import * as settingsApi from "../../api/settings";
import * as workspacesApi from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
import { useBranding } from "../../context/BrandingContext";
import { useToast } from "../../context/ToastContext";
import { getUtcOffsetLabel, getUtcOffsetMinutes } from "../../utils/datetime";
import PowerBiConnectionsSection from "../../components/PowerBiConnectionsSection";

// Lista curada -- um fuso por regiao relevante, em vez do dump completo de ~400 zonas IANA.
const TIMEZONE_OPTIONS: { tz: string; label: string }[] = [
  { tz: "Pacific/Midway", label: "Midway, Samoa" },
  { tz: "Pacific/Honolulu", label: "Havai" },
  { tz: "America/Anchorage", label: "Anchorage" },
  { tz: "America/Los_Angeles", label: "Los Angeles, Vancouver" },
  { tz: "America/Denver", label: "Denver, Phoenix" },
  { tz: "America/Mexico_City", label: "Cidade do Mexico" },
  { tz: "America/Chicago", label: "Chicago, Dallas" },
  { tz: "America/Bogota", label: "Bogota, Lima" },
  { tz: "America/New_York", label: "Nova York, Toronto" },
  { tz: "America/Manaus", label: "Manaus" },
  { tz: "America/Rio_Branco", label: "Rio Branco" },
  { tz: "America/Halifax", label: "Halifax" },
  { tz: "America/Sao_Paulo", label: "Brasilia, Sao Paulo" },
  { tz: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { tz: "America/Noronha", label: "Fernando de Noronha" },
  { tz: "Atlantic/Azores", label: "Acores" },
  { tz: "UTC", label: "UTC" },
  { tz: "Europe/Lisbon", label: "Lisboa" },
  { tz: "Europe/London", label: "Londres, Dublin" },
  { tz: "Europe/Paris", label: "Paris, Madri, Berlim, Roma" },
  { tz: "Europe/Athens", label: "Atenas, Helsinque" },
  { tz: "Europe/Moscow", label: "Moscou" },
  { tz: "Asia/Dubai", label: "Dubai" },
  { tz: "Asia/Karachi", label: "Carachi" },
  { tz: "Asia/Kolkata", label: "Nova Deli, Mumbai" },
  { tz: "Asia/Dhaka", label: "Daca" },
  { tz: "Asia/Bangkok", label: "Bangcoc, Jacarta" },
  { tz: "Asia/Shanghai", label: "Pequim, Xangai, Hong Kong" },
  { tz: "Asia/Tokyo", label: "Toquio, Seul" },
  { tz: "Australia/Sydney", label: "Sydney, Melbourne" },
  { tz: "Pacific/Auckland", label: "Auckland" },
];

function listTimezones(current: string) {
  const known = TIMEZONE_OPTIONS.some((o) => o.tz === current)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { tz: current, label: current }];

  return known
    .map((option) => ({
      ...option,
      offsetMinutes: getUtcOffsetMinutes(option.tz),
      offsetLabel: getUtcOffsetLabel(option.tz),
    }))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
}

export default function GeneralTab() {
  const { settings, reload } = useBranding();
  const [companyName, setCompanyName] = useState(settings?.company_name || "");
  const [siteUrl, setSiteUrl] = useState(settings?.site_url || "");
  const [supportEmail, setSupportEmail] = useState(settings?.support_email || "");
  const [forceHttps, setForceHttps] = useState(settings?.force_https || false);
  const [timezone, setTimezone] = useState(settings?.timezone || "America/Sao_Paulo");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<number | "">(settings?.default_workspace_id || "");

  useEffect(() => {
    workspacesApi.listAllWorkspaces().then(setWorkspaces);
  }, []);

  useEffect(() => {
    // Sincroniza os campos se a marca ainda nao tinha carregado quando o componente montou
    // (ex: usuario navega direto pra Configuracoes antes do BrandingContext terminar o fetch inicial).
    if (!settings) return;
    setCompanyName(settings.company_name || "");
    setSiteUrl(settings.site_url || "");
    setSupportEmail(settings.support_email || "");
    setForceHttps(settings.force_https || false);
    setTimezone(settings.timezone || "America/Sao_Paulo");
    setHomeWorkspaceId(settings.default_workspace_id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings === null]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        company_name: companyName,
        site_url: siteUrl || null,
        support_email: supportEmail || null,
        force_https: forceHttps,
        timezone,
      });
      await reload();
      showToast("Configuracoes salvas.");
    } finally {
      setSaving(false);
    }
  }

  async function handleHomeWorkspaceChange(value: string) {
    const workspaceId = value ? Number(value) : "";
    setHomeWorkspaceId(workspaceId);
    await settingsApi.updateSettings({ default_workspace_id: workspaceId || null });
    await reload();
  }

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section-title">Configuracao do aplicativo</h2>
        <p className="settings-section-desc">Informacoes gerais desta instancia do sistema.</p>

        <form onSubmit={handleSubmit}>
          <div className="settings-grid">
            <label className="field">
              Nome do site
              <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <span style={{ fontWeight: 400, fontSize: 12 }}>Usado nesta instancia -- aparece na sidebar e na tela de login.</span>
            </label>

            <label className="field">
              URL do site
              <input
                className="input"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://relatorios.minhaempresa.com"
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Usado como referencia em links gerados pelo sistema. So mude se souber o que esta fazendo.
              </span>
            </label>

            <label className="field">
              E-mail de suporte
              <input
                className="input"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="suporte@minhaempresa.com"
              />
              <span style={{ fontWeight: 400, fontSize: 12 }}>Para onde os usuarios devem ir se encontrarem um problema.</span>
            </label>

            <label className="field">
              Fuso horario
              <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {listTimezones(timezone).map((option) => (
                  <option key={option.tz} value={option.tz}>
                    ({option.offsetLabel}) {option.label}
                  </option>
                ))}
              </select>
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                Usado para exibir horarios em todo o portal, incluindo a Auditoria. Atual:{" "}
                {getUtcOffsetLabel(timezone)}.
              </span>
            </label>

            <label className="field">
              Redirecionar para HTTPS
              <div className="toggle-field" style={{ marginTop: 4 }}>
                <label className="toggle-switch">
                  <input type="checkbox" checked={forceHttps} onChange={(e) => setForceHttps(e.target.checked)} />
                  <span className="toggle-switch-track" />
                </label>
                <span style={{ fontWeight: 400, fontSize: 13, color: "var(--color-text-muted)" }}>
                  {forceHttps ? "Habilitado" : "Desabilitado"}
                </span>
              </div>
              <span style={{ fontWeight: 400, fontSize: 12 }}>
                So funciona quando o site esta acessivel por um dominio real (nao afeta localhost).
              </span>
            </label>
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Homepage</h2>
        <p className="settings-section-desc">Colecao que os usuarios veem primeiro ao entrar no sistema.</p>

        <div className="settings-grid">
          <label className="field">
            Colecao
            <select className="input" value={homeWorkspaceId} onChange={(e) => handleHomeWorkspaceChange(e.target.value)}>
              <option value="">Nenhuma (tela padrao)</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 12, marginBottom: 0 }}>
          Usuarios sem acesso a essa colecao veem a tela padrao normalmente.
        </p>
      </div>

      <PowerBiConnectionsSection />
    </div>
  );
}
