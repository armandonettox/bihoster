import { useEffect, useRef, useState } from "react";
import * as capacityApi from "../../api/cacheCapacity";
import type { Openings } from "../../api/cacheCapacity";
import * as settingsApi from "../../api/settings";
import type { AppSettings, CacheStats } from "../../api/settings";
import { extractErrorMessage } from "../../api/client";
import AdminSectionModal from "../../components/AdminSectionModal";
import ConfirmDialog from "../../components/ConfirmDialog";
import { Field, ToggleField } from "../../components/SettingsFields";
import SettingsEditModal from "../../components/SettingsEditModal";
import SettingsRowList, { type SettingsRow } from "../../components/SettingsRowList";
import { SkeletonCard } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../utils/datetime";
import CapacityBody from "./CapacityBody";

const STATS_POLL_MS = 30_000;
const INTERVAL_MIN = 30;
const INTERVAL_MAX = 3600;

type Editing = "warmup" | "status" | "options" | "openings" | "capacity" | "querycache" | null;

/** O aquecimento automático: liga e desliga e de quanto em quanto tempo o sistema renova os tokens */
function CacheWarmupModal({
  settings,
  onSaved,
  onClose,
}: {
  settings: AppSettings;
  onSaved: (updated: AppSettings) => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const savedEnabled = settings.cache_warmup_enabled ?? true;
  const savedInterval = String(settings.cache_warmup_interval_seconds);
  const [enabled, setEnabled] = useState(savedEnabled);
  const [interval, setIntervalDraft] = useState(savedInterval);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seconds = parseInt(interval, 10);
  const intervalValid = !isNaN(seconds) && seconds >= INTERVAL_MIN && seconds <= INTERVAL_MAX;
  // Com o aquecimento desligado o intervalo nao conta: so vale ele estar certo quando for usado
  const canSave = !enabled || intervalValid;
  const dirty = enabled !== savedEnabled || interval !== savedInterval;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.updateSettings({
        cache_warmup_enabled: enabled,
        cache_warmup_interval_seconds: intervalValid ? seconds : settings.cache_warmup_interval_seconds,
      });
      onSaved(updated);
      showToast("Configuracoes de cache salvas.");
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Aquecimento automatico"
      description="O backend pre-gera tokens de embed do Power BI para todos os relatorios e os renova em segundo plano, sem bloquear o uso. Quando um usuario abre um relatorio, o token ja esta pronto."
      dirty={dirty}
      saving={saving}
      error={error}
      canSave={canSave}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <ToggleField
        id="cache-warmup-enabled"
        label="Aquecimento automatico"
        hint="Desligar faz o token ser gerado so quando alguem abre o relatorio (mais lento na primeira abertura)."
        checked={enabled}
        onChange={setEnabled}
      />
      <Field
        id="cache-interval"
        label="Intervalo de renovacao (segundos)"
        hint="Com que frequencia o sistema verifica e renova tokens proximos de vencer. Minimo 30s, maximo 3600s (1h). Padrao: 240s (4 min)."
        className="field-spaced"
      >
        <input
          id="cache-interval"
          type="number"
          className="input"
          min={INTERVAL_MIN}
          max={INTERVAL_MAX}
          value={interval}
          disabled={!enabled}
          aria-describedby="cache-interval-hint"
          aria-invalid={enabled && !intervalValid}
          onChange={(e) => setIntervalDraft(e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </Field>
      {enabled && !intervalValid && (
        <span className="field-error" role="alert">
          Intervalo deve ser entre {INTERVAL_MIN} e {INTERVAL_MAX} segundos.
        </span>
      )}
    </SettingsEditModal>
  );
}

/** Pré-carga dos scripts no navegador e aquecimento só do que foi aberto há pouco */
function CacheOptionsModal({ settings, onSaved, onClose }: { settings: AppSettings; onSaved: (updated: AppSettings) => void; onClose: () => void }) {
  const { showToast } = useToast();
  const [preload, setPreload] = useState(settings.embed_preload_enabled !== false);
  const [onlyRecent, setOnlyRecent] = useState(Boolean(settings.cache_warmup_only_recent));
  const [hours, setHours] = useState(String(settings.cache_warmup_recent_hours ?? 72));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseInt(hours, 10);
  const hoursValid = !isNaN(parsed) && parsed >= 1 && parsed <= 720;
  const dirty =
    preload !== (settings.embed_preload_enabled !== false) ||
    onlyRecent !== Boolean(settings.cache_warmup_only_recent) ||
    hours !== String(settings.cache_warmup_recent_hours ?? 72);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.updateSettings({
        embed_preload_enabled: preload,
        cache_warmup_only_recent: onlyRecent,
        cache_warmup_recent_hours: hoursValid ? parsed : settings.cache_warmup_recent_hours,
      });
      onSaved(updated);
      showToast("Opcoes de cache salvas.");
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) || "Nao foi possivel salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsEditModal
      title="Pre-carga e aquecimento recente"
      description="Duas formas de abrir mais rapido sem gastar a toa."
      dirty={dirty}
      saving={saving}
      error={error}
      canSave={!onlyRecent || hoursValid}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <ToggleField
        id="cache-preload"
        label="Pre-carregar o Power BI no navegador"
        hint="Baixa antes os scripts do Power BI (powerbi.preload, recomendado pela Microsoft quando o relatorio abre em outra pagina). Vem ligado; desligue se a rede for restrita."
        checked={preload}
        onChange={setPreload}
      />
      <ToggleField
        id="cache-only-recent"
        label="Aquecer so os relatorios abertos recentemente"
        hint="Vem desligado (aquece todos). Ligado, o aquecimento preenche so o que alguem abriu nas ultimas horas, poupando a capacidade."
        checked={onlyRecent}
        onChange={setOnlyRecent}
      />
      <Field id="cache-recent-hours" label="Considerar recente: ultimas (horas)" hint="De 1 a 720. Padrao: 72." className="field-spaced">
        <input
          id="cache-recent-hours"
          type="number"
          className="input"
          min={1}
          max={720}
          value={hours}
          disabled={!onlyRecent}
          aria-invalid={onlyRecent && !hoursValid}
          onChange={(e) => setHours(e.target.value)}
          style={{ maxWidth: 160 }}
        />
      </Field>
    </SettingsEditModal>
  );
}

/** Aberturas de relatório por hora (só contagem): os mais abertos nas últimas 24 horas */
function OpeningsBody() {
  const [data, setData] = useState<Openings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    capacityApi.getOpenings(24).then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="auth-error" role="alert">Nao foi possivel carregar as aberturas.</p>;
  if (!data) return <p className="field-hint">Carregando...</p>;
  if (data.reports.length === 0) return <p className="field-hint">Nenhum relatorio foi aberto nas ultimas {data.hours} horas.</p>;
  const hoursList = Array.from(new Set(data.reports.flatMap((r) => Object.keys(r.by_hour)))).sort();
  return (
    <>
      <p className="field-hint" style={{ marginTop: 0 }}>
        Aberturas por hora (UTC) nas ultimas {data.hours} horas. So a contagem: nao guarda quem abriu. Serve de base para aquecer so o que e usado.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table" aria-label="Aberturas por relatorio e por hora">
          <thead>
            <tr>
              <th>Relatorio</th>
              <th>Total</th>
              {hoursList.map((hour) => (
                <th key={hour}>{hour.slice(11)}h</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.reports.map((report) => (
              <tr key={report.report_id}>
                <td>{report.report_name}</td>
                <td><strong>{report.total}</strong></td>
                {hoursList.map((hour) => (
                  <td key={hour}>{report.by_hour[hour] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Orientação sobre o cache de consultas do modelo (configuração do Power BI, não do BIHoster) */
function QueryCacheBody() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        O Power BI tem um <strong>cache de consultas</strong> por modelo semantico, que guarda os resultados da pagina inicial dos relatorios e
        faz a primeira abertura depois de cada atualizacao ser mais rapida.
      </p>
      <ul>
        <li>Fica em Configuracoes do modelo, no servico do Power BI: Capacidade padrao, Desligado ou Ligado.</li>
        <li>Vale so para modelos Import em capacidade Premium ou Embedded (nao para DirectQuery nem conexao ativa).</li>
        <li>Os resultados ficam separados por pessoa e sempre respeitam a seguranca por linha.</li>
        <li>A atualizacao feita pela API enhanced refresh ou pelo XMLA nao renova esse cache sozinha.</li>
      </ul>
      <p className="field-hint">
        O BIHoster nao liga isso por voce: a Microsoft nao oferece uma API para esse ajuste e ele depende da capacidade. Quem cuida do Power BI
        decide. Referencia:{" "}
        <a href="https://learn.microsoft.com/en-us/power-bi/connect-data/power-bi-query-caching" target="_blank" rel="noreferrer">
          Query caching in Power BI Premium
        </a>
        .
      </p>
    </>
  );
}

/** Os números do cache e o estado da tarefa de aquecimento, que se atualizam sozinhos */
function CacheStatusBody({ stats }: { stats: CacheStats | null }) {
  if (!stats) return <p style={{ color: "var(--color-text-muted)" }}>Nao foi possivel carregar o status.</p>;
  return (
    <>
      <p className="field-hint" style={{ marginTop: 0 }}>Atualiza a cada 30s</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Tokens de embed", value: stats.embed_tokens },
          { label: "Dados estaticos", value: stats.report_static },
          { label: "Info de atualizacao", value: stats.refresh_info },
          { label: "Total em cache", value: stats.total_entries },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px" }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, color: "var(--color-text-muted)", display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
        <span>
          Tarefa:{" "}
          <strong style={{ color: stats.warmup_running ? "var(--color-success, #2e7d32)" : "var(--color-danger)" }}>
            {stats.warmup_running ? "rodando" : "parada"}
          </strong>
        </span>
        {stats.last_run_at && <span>Ultimo ciclo: <strong>{formatDateTime(stats.last_run_at)}</strong></span>}
        {stats.last_run_stats.relatorios !== undefined && (
          <span>
            {stats.last_run_stats.relatorios} relatorios, {stats.last_run_stats.tokens_novos} tokens novos,{" "}
            {stats.last_run_stats.erros} erros
          </span>
        )}
      </div>
    </>
  );
}

export default function CacheTab() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function loadStats() {
    return settingsApi.getCacheStats().then(setStats).catch(() => {});
  }

  useEffect(() => {
    Promise.all([settingsApi.getSettings().then(setSettings), loadStats()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function schedule() {
      pollRef.current = setTimeout(async () => {
        await loadStats();
        schedule();
      }, STATS_POLL_MS);
    }
    schedule();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function handleSaved(updated: AppSettings) {
    setSettings(updated);
    await loadStats();
  }

  async function handleReset() {
    setConfirmReset(false);
    setResetting(true);
    try {
      const freshStats = await settingsApi.resetCache();
      setStats(freshStats);
      showToast("Cache limpo. Os tokens serao gerados novamente ao proximo acesso.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel limpar o cache.", "error");
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-section">
        <SkeletonCard />
      </div>
    );
  }

  const enabled = settings?.cache_warmup_enabled ?? true;
  const intervalSeconds = settings?.cache_warmup_interval_seconds;

  const rows: SettingsRow[] = [
    {
      key: "warmup",
      label: "Aquecimento automatico",
      description: "Liga e desliga a renovacao dos tokens em segundo plano e define de quanto em quanto tempo ela roda.",
      summary: enabled && intervalSeconds ? `Renova a cada ${intervalSeconds} segundos` : undefined,
      status: enabled ? "Ligado" : "Desligado",
      highlight: enabled,
      onEdit: () => setEditing("warmup"),
      disabled: settings === null,
    },
    {
      key: "status",
      label: "Status do cache",
      description: "Quantos itens estao em cache e se a tarefa de aquecimento esta rodando.",
      summary: stats ? `${stats.total_entries} em cache · tarefa ${stats.warmup_running ? "rodando" : "parada"}` : undefined,
      actionLabel: "Abrir",
      onEdit: () => setEditing("status"),
    },
    {
      key: "options",
      label: "Pre-carga e aquecimento recente",
      description: "Pre-carregar o Power BI no navegador e aquecer so o que foi aberto ha pouco.",
      summary: `Pre-carga ${settings?.embed_preload_enabled !== false ? "ligada" : "desligada"} · aquecimento ${settings?.cache_warmup_only_recent ? `so dos abertos nas ultimas ${settings.cache_warmup_recent_hours} h` : "de todos os relatorios"}`,
      onEdit: () => setEditing("options"),
      disabled: settings === null,
    },
    {
      key: "openings",
      label: "Aberturas por hora",
      description: "Quantas vezes cada relatorio foi aberto nas ultimas 24 horas (so a contagem).",
      actionLabel: "Abrir",
      onEdit: () => setEditing("openings"),
    },
    {
      key: "capacity",
      label: "Capacidade do Power BI",
      description: "Pausar e retomar a capacidade pelo Azure, por agenda ou por botao. Tudo vem desligado e em modo simulado.",
      status: settings?.capacity_control_enabled ? "Ligado" : "Desligado",
      highlight: Boolean(settings?.capacity_control_enabled),
      onEdit: () => setEditing("capacity"),
      disabled: settings === null,
    },
    {
      key: "querycache",
      label: "Cache de consultas do modelo",
      description: "Orientacao sobre o ajuste do Power BI que acelera a primeira abertura depois de cada atualizacao.",
      actionLabel: "Ler",
      onEdit: () => setEditing("querycache"),
    },
    {
      key: "reset",
      label: "Resetar cache",
      description:
        "Limpa todos os tokens em cache agora. Util para forcar atualizacao apos uma troca de conta Power BI ou quando um relatorio apresentar problema de acesso.",
      actionLabel: resetting ? "Limpando..." : "Resetar",
      ariaLabel: "Resetar o cache agora",
      danger: true,
      onEdit: () => setConfirmReset(true),
      disabled: resetting,
    },
  ];

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Cache e capacidade</h2>
      <p className="settings-section-desc">
        O backend pre-gera tokens de embed do Power BI para todos os relatorios e os renova em segundo plano, sem bloquear o
        uso. Abra uma parte para ajustar ou consultar.
      </p>
      <SettingsRowList rows={rows} />

      {settings && editing === "warmup" && (
        <CacheWarmupModal settings={settings} onSaved={(updated) => void handleSaved(updated)} onClose={() => setEditing(null)} />
      )}
      {settings && editing === "options" && (
        <CacheOptionsModal settings={settings} onSaved={(updated) => void handleSaved(updated)} onClose={() => setEditing(null)} />
      )}
      {editing === "openings" && (
        <AdminSectionModal title="Aberturas por hora" onClose={() => setEditing(null)}>
          <OpeningsBody />
        </AdminSectionModal>
      )}
      {settings && editing === "capacity" && (
        <AdminSectionModal title="Capacidade do Power BI" onClose={() => setEditing(null)}>
          <CapacityBody
            masterSwitch={Boolean(settings.capacity_control_enabled)}
            onMasterChange={async (value) => {
              try {
                setSettings(await settingsApi.updateSettings({ capacity_control_enabled: value }));
                showToast(value ? "Controle da capacidade permitido." : "Controle da capacidade desligado.");
              } catch (err) {
                showToast(extractErrorMessage(err) || "Nao foi possivel salvar.", "error");
              }
            }}
          />
        </AdminSectionModal>
      )}
      {editing === "querycache" && (
        <AdminSectionModal title="Cache de consultas do modelo" onClose={() => setEditing(null)}>
          <QueryCacheBody />
        </AdminSectionModal>
      )}
      {editing === "status" && (
        <AdminSectionModal title="Status do cache" onClose={() => setEditing(null)}>
          <CacheStatusBody stats={stats} />
        </AdminSectionModal>
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Resetar cache"
          message="Isso vai limpar todos os tokens de embed em cache. Os usuarios que abrirem um relatorio logo apos vao esperar o token ser gerado na hora (pode levar alguns segundos). O aquecimento automatico vai preencher o cache novamente em breve."
          confirmLabel="Resetar cache"
          onConfirm={handleReset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
