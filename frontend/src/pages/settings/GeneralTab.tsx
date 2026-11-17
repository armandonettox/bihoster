import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import * as settingsApi from "../../api/settings";
import { extractErrorMessage } from "../../api/client";
import * as workspacesApi from "../../api/workspaces";
import type { Workspace } from "../../api/workspaces";
import { useBranding } from "../../context/BrandingContext";
import { useToast } from "../../context/ToastContext";
import { getUtcOffsetLabel, getUtcOffsetMinutes } from "../../utils/datetime";
import ConfirmDialog from "../../components/ConfirmDialog";
import PowerBiConnectionsSection from "../../components/PowerBiConnectionsSection";

// Lista curada -- um fuso por regiao relevante, em vez do dump completo de ~400 zonas IANA.
const TIMEZONE_OPTIONS: { tz: string; label: string }[] = [
  { tz: "Pacific/Midway", label: "Midway, Samoa" },
  { tz: "Pacific/Honolulu", label: "Havaí" },
  { tz: "America/Anchorage", label: "Anchorage" },
  { tz: "America/Los_Angeles", label: "Los Angeles, Vancouver" },
  { tz: "America/Denver", label: "Denver, Phoenix" },
  { tz: "America/Mexico_City", label: "Cidade do México" },
  { tz: "America/Chicago", label: "Chicago, Dallas" },
  { tz: "America/Bogota", label: "Bogotá, Lima" },
  { tz: "America/New_York", label: "Nova York, Toronto" },
  { tz: "America/Manaus", label: "Manaus" },
  { tz: "America/Rio_Branco", label: "Rio Branco" },
  { tz: "America/Halifax", label: "Halifax" },
  { tz: "America/Sao_Paulo", label: "Brasília, São Paulo" },
  { tz: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { tz: "America/Noronha", label: "Fernando de Noronha" },
  { tz: "Atlantic/Azores", label: "Açores" },
  { tz: "UTC", label: "UTC" },
  { tz: "Europe/Lisbon", label: "Lisboa" },
  { tz: "Europe/London", label: "Londres, Dublin" },
  { tz: "Europe/Paris", label: "Paris, Madri, Berlim, Roma" },
  { tz: "Europe/Athens", label: "Atenas, Helsinque" },
  { tz: "Europe/Moscow", label: "Moscou" },
  { tz: "Asia/Dubai", label: "Dubai" },
  { tz: "Asia/Karachi", label: "Carachi" },
  { tz: "Asia/Kolkata", label: "Nova Délhi, Mumbai" },
  { tz: "Asia/Dhaka", label: "Daca" },
  { tz: "Asia/Bangkok", label: "Bangcoc, Jacarta" },
  { tz: "Asia/Shanghai", label: "Pequim, Xangai, Hong Kong" },
  { tz: "Asia/Tokyo", label: "Tóquio, Seul" },
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

/** Campo com rótulo e dica. A dica fica fora do rótulo e é ligada ao campo por aria-describedby, para o leitor de
 * tela ler o nome do campo sem a dica junto. O campo (input ou select) leva o mesmo `id` e `aria-describedby`. */
function Field({
  id,
  label,
  hint,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Interruptor com rótulo e dica. O rótulo é um texto à parte (não um label em volta de outro label), e o
 * interruptor leva o nome e a descrição por aria-labelledby e aria-describedby. */
function ToggleField({
  id,
  label,
  hint,
  checked,
  onChange,
  className = "",
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <span id={`${id}-label`}>{label}</span>
      <div className="toggle-field">
        <label className="toggle-switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            aria-labelledby={`${id}-label ${id}-state`}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="toggle-switch-track" />
        </label>
        <span id={`${id}-state`} className="toggle-state">
          {checked ? "Habilitado" : "Desabilitado"}
        </span>
      </div>
      <span id={`${id}-hint`} className="field-hint">
        {hint}
      </span>
    </div>
  );
}

export default function GeneralTab() {
  const { settings, reload } = useBranding();
  const [companyName, setCompanyName] = useState(settings?.company_name || "");
  const [siteUrl, setSiteUrl] = useState(settings?.site_url || "");
  const [supportEmail, setSupportEmail] = useState(settings?.support_email || "");
  const [forceHttps, setForceHttps] = useState(settings?.force_https || false);
  const [timezone, setTimezone] = useState(settings?.timezone || "America/Sao_Paulo");
  const [saving, setSaving] = useState(false);
  const [confirmingHttps, setConfirmingHttps] = useState(false);
  const { showToast } = useToast();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [homeWorkspaceId, setHomeWorkspaceId] = useState<number | "">(settings?.default_workspace_id || "");
  const [singleCollectionRedirect, setSingleCollectionRedirect] = useState(settings?.single_collection_redirect || false);

  useEffect(() => {
    workspacesApi
      .listAllWorkspaces()
      .then(setWorkspaces)
      .catch(() => setWorkspaces([])); // sem a lista o seletor da Homepage fica só com "Nenhuma"
  }, []);

  function fillFromSettings() {
    if (!settings) return;
    setCompanyName(settings.company_name || "");
    setSiteUrl(settings.site_url || "");
    setSupportEmail(settings.support_email || "");
    setForceHttps(settings.force_https || false);
    setTimezone(settings.timezone || "America/Sao_Paulo");
    setHomeWorkspaceId(settings.default_workspace_id || "");
    setSingleCollectionRedirect(settings.single_collection_redirect || false);
  }

  useEffect(() => {
    // Sincroniza os campos se a marca ainda não tinha carregado quando o componente montou
    // (ex: usuário navega direto pra Configurações antes do BrandingContext terminar o fetch inicial).
    fillFromSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings === null]);

  // Mudou alguma coisa em relação ao que está salvo? Sem mudança a barra de salvar nem aparece.
  const dirty =
    settings !== null &&
    (companyName !== (settings.company_name || "") ||
      siteUrl !== (settings.site_url || "") ||
      supportEmail !== (settings.support_email || "") ||
      forceHttps !== (settings.force_https || false) ||
      timezone !== (settings.timezone || "America/Sao_Paulo") ||
      homeWorkspaceId !== (settings.default_workspace_id || "") ||
      singleCollectionRedirect !== (settings.single_collection_redirect || false));

  async function save() {
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        company_name: companyName,
        site_url: siteUrl || null,
        support_email: supportEmail || null,
        force_https: forceHttps,
        timezone,
        default_workspace_id: homeWorkspaceId || null,
        single_collection_redirect: singleCollectionRedirect,
      });
      await reload();
      showToast("Configurações salvas.");
    } catch (err: any) {
      // Os campos ficam como estão: quem digitou não perde o que escreveu
      showToast(extractErrorMessage(err) || "Não foi possível salvar as configurações.", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    // Ligar o HTTPS com o site ainda sem certificado pode deixar o portal fora do ar: pede confirmação antes
    if (forceHttps && !settings?.force_https) {
      setConfirmingHttps(true);
      return;
    }
    void save();
  }

  function handleConfirmHttps() {
    setConfirmingHttps(false);
    void save();
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="settings-section">
          <h2 className="settings-section-title">Configuração do aplicativo</h2>
          <p className="settings-section-desc">Informações gerais desta instância do sistema.</p>

          <div className="settings-grid settings-grid-two">
            <Field
              id="general-company-name"
              label="Nome do site"
              hint="Usado nesta instância. Aparece na barra lateral e na tela de login."
            >
              <input
                id="general-company-name"
                className="input"
                value={companyName}
                aria-describedby="general-company-name-hint"
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </Field>

            <Field
              id="general-site-url"
              label="URL do site"
              hint="Usada como referência em links gerados pelo sistema. Só mude se souber o que está fazendo."
            >
              <input
                id="general-site-url"
                className="input"
                value={siteUrl}
                aria-describedby="general-site-url-hint"
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://relatorios.minhaempresa.com"
              />
            </Field>

            <Field
              id="general-support-email"
              label="E-mail de suporte"
              hint="Para onde os usuários devem ir se encontrarem um problema."
            >
              <input
                id="general-support-email"
                className="input"
                type="email"
                value={supportEmail}
                aria-describedby="general-support-email-hint"
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="suporte@minhaempresa.com"
              />
            </Field>

            <Field
              id="general-timezone"
              label="Fuso horário"
              hint={`Usado para exibir horários em todo o portal, incluindo a Auditoria. Atual: ${getUtcOffsetLabel(timezone)}.`}
            >
              <select
                id="general-timezone"
                className="input"
                value={timezone}
                aria-describedby="general-timezone-hint"
                onChange={(e) => setTimezone(e.target.value)}
              >
                {listTimezones(timezone).map((option) => (
                  <option key={option.tz} value={option.tz}>
                    ({option.offsetLabel}) {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <ToggleField
              id="general-force-https"
              className="settings-grid-full"
              label="Redirecionar para HTTPS"
              hint="Só funciona quando o site está acessível por um domínio real (não afeta localhost)."
              checked={forceHttps}
              onChange={setForceHttps}
            />
          </div>
        </div>

        <div className="settings-section">
          <h2 className="settings-section-title">Homepage</h2>
          <p className="settings-section-desc">Coleção que os usuários veem primeiro ao entrar no sistema.</p>

          <div className="settings-stack">
            <Field
              id="general-home-collection"
              label="Coleção"
              className="field-narrow"
              hint="Usuários sem acesso a essa coleção veem a tela padrão normalmente."
            >
              <select
                id="general-home-collection"
                className="input"
                value={homeWorkspaceId}
                aria-describedby="general-home-collection-hint"
                onChange={(e) => setHomeWorkspaceId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Nenhuma (tela padrão)</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>

            <ToggleField
              id="general-single-collection"
              label="Abrir direto na coleção única"
              hint="Quando ativado, usuários com acesso a uma única coleção entram direto nela, sem passar pela tela inicial."
              checked={singleCollectionRedirect}
              onChange={setSingleCollectionRedirect}
            />
          </div>
        </div>

        {(dirty || saving) && (
          <div className="settings-savebar" role="region" aria-label="Salvar configurações">
            <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
            {!saving && (
              <>
                <button type="button" className="btn btn-ghost" onClick={fillFromSettings}>
                  Descartar
                </button>
                <span className="settings-savebar-hint" role="status">
                  Você tem alterações não salvas.
                </span>
              </>
            )}
          </div>
        )}
      </form>

      {confirmingHttps && (
        <ConfirmDialog
          title="Ligar o redirecionamento para HTTPS?"
          message="Depois de salvar, quem abrir o portal por http será levado para https. Se o domínio ainda não tiver certificado, ou se o site não abrir por https, o acesso ao portal pode ficar fora do ar. Confirme só se você já consegue abrir o site por https."
          confirmLabel="Ligar e salvar"
          onConfirm={handleConfirmHttps}
          onCancel={() => setConfirmingHttps(false)}
        />
      )}

      <PowerBiConnectionsSection />
    </div>
  );
}
