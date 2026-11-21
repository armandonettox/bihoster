import { useEffect, useRef, useState } from "react";
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

const STATS_POLL_MS = 30_000;
const INTERVAL_MIN = 30;
const INTERVAL_MAX = 3600;

type Editing = "warmup" | "status" | null;

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
      <h2 className="settings-section-title">Cache de embed</h2>
      <p className="settings-section-desc">
        O backend pre-gera tokens de embed do Power BI para todos os relatorios e os renova em segundo plano, sem bloquear o
        uso. Abra uma parte para ajustar ou consultar.
      </p>
      <SettingsRowList rows={rows} />

      {settings && editing === "warmup" && (
        <CacheWarmupModal settings={settings} onSaved={(updated) => void handleSaved(updated)} onClose={() => setEditing(null)} />
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
