import { useEffect, useRef, useState } from "react";
import * as settingsApi from "../../api/settings";
import type { AppSettings, CacheStats } from "../../api/settings";
import { extractErrorMessage } from "../../api/client";
import ConfirmDialog from "../../components/ConfirmDialog";
import { SkeletonCard } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../utils/datetime";

const STATS_POLL_MS = 30_000;

export default function CacheTab() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState<string>("240");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function loadStats() {
    return settingsApi.getCacheStats().then(setStats).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      settingsApi.getSettings().then((s) => {
        setSettings(s);
        setIntervalDraft(String(s.cache_warmup_interval_seconds));
      }),
      loadStats(),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function schedule() {
      pollRef.current = setTimeout(async () => {
        await loadStats();
        schedule();
      }, STATS_POLL_MS);
    }
    schedule();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  async function handleSave() {
    if (!settings) return;
    const interval = parseInt(intervalDraft, 10);
    if (isNaN(interval) || interval < 30 || interval > 3600) {
      showToast("Intervalo deve ser entre 30 e 3600 segundos.", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await settingsApi.updateSettings({
        cache_warmup_enabled: settings.cache_warmup_enabled,
        cache_warmup_interval_seconds: interval,
      });
      setSettings(updated);
      setIntervalDraft(String(updated.cache_warmup_interval_seconds));
      await loadStats();
      showToast("Configuracoes de cache salvas.");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel salvar.", "error");
    } finally {
      setSaving(false);
    }
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

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Cache de embed</h2>
      <p className="settings-section-desc">
        O backend pre-gera tokens de embed do Power BI para todos os relatorios e os renova em
        segundo plano, sem bloquear o uso. Quando um usuario abre um relatorio, o token ja esta
        pronto -- sem esperar uma chamada ao Power BI na hora.
      </p>

      {/* Configuracoes */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Configuracoes</h3>

        <div className="form-row" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => settings && setSettings({ ...settings, cache_warmup_enabled: e.target.checked })}
            />
            Aquecimento automatico habilitado
          </label>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4, marginLeft: 24 }}>
            Desligar faz o token ser gerado so quando alguem abre o relatorio (mais lento na primeira abertura).
          </p>
        </div>

        <div className="form-row" style={{ marginBottom: 20 }}>
          <label className="form-label" htmlFor="cache-interval">
            Intervalo de renovacao (segundos)
          </label>
          <input
            id="cache-interval"
            type="number"
            className="form-input"
            min={30}
            max={3600}
            value={intervalDraft}
            onChange={(e) => setIntervalDraft(e.target.value)}
            disabled={!enabled}
            style={{ maxWidth: 160 }}
          />
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
            Com que frequencia o sistema verifica e renova tokens proximos de vencer. Minimo 30s, maximo 3600s (1h). Padrao: 240s (4 min).
          </p>
        </div>

        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {/* Stats ao vivo */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Status atual</h3>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Atualiza a cada 30s</span>
        </div>

        {stats ? (
          <>
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
              {stats.last_run_at && (
                <span>Ultimo ciclo: <strong>{formatDateTime(stats.last_run_at)}</strong></span>
              )}
              {stats.last_run_stats.relatorios !== undefined && (
                <span>
                  {stats.last_run_stats.relatorios} relatorios,{" "}
                  {stats.last_run_stats.tokens_novos} tokens novos,{" "}
                  {stats.last_run_stats.erros} erros
                </span>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--color-text-muted)" }}>Nao foi possivel carregar o status.</p>
        )}
      </div>

      {/* Reset */}
      <div className="card" style={{ padding: 20, borderColor: "var(--color-danger)", borderWidth: 1, borderStyle: "solid" }}>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 8, color: "var(--color-danger)" }}>Resetar cache</h3>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>
          Limpa todos os tokens em cache imediatamente. Util para forcas atualizacao apos uma troca
          de conta Power BI ou quando um relatorio apresentar problema de acesso. Os tokens serao
          regenerados automaticamente na proxima abertura ou no proximo ciclo de aquecimento.
        </p>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => setConfirmReset(true)}
          disabled={resetting}
        >
          {resetting ? "Limpando..." : "Resetar cache agora"}
        </button>
      </div>

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
