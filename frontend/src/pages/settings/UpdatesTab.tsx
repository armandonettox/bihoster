import { useEffect, useState } from "react";
import * as systemApi from "../../api/system";
import type { ReleaseInfo, VersionStatus } from "../../api/system";
import ConfirmDialog from "../../components/ConfirmDialog";
import { SkeletonCard } from "../../components/Skeleton";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";
import { formatDateTime } from "../../utils/datetime";

// "dev" e o build local (docker-compose.dev.yml, sem tag de release) -- prefixar com "v"
// vira "vdev", que confunde. So versoes numericas de release ganham o "v" na frente.
function formatVersion(version: string | undefined): string {
  if (!version) return "";
  return version === "dev" ? "dev (build local)" : `v${version}`;
}

export default function UpdatesTab() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [history, setHistory] = useState<ReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  function toggleExpanded(version: string) {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  }

  function loadStatus() {
    return systemApi
      .getVersionStatus()
      .then(setStatus)
      .catch(() => showToast("Nao foi possivel verificar atualizacoes agora.", "error"));
  }

  useEffect(() => {
    Promise.all([
      loadStatus(),
      systemApi.getVersionHistory().then((releases) => {
        setHistory(releases);
        // Abre a mais recente por padrao -- e a que a pessoa provavelmente quer ler primeiro,
        // igual uma nota de atualizacao.
        if (releases.length > 0) {
          setExpandedVersions(new Set([releases[0].version]));
        }
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApply() {
    setConfirmOpen(false);
    setApplying(true);
    try {
      const result = await systemApi.applyUpdate();
      showToast(result.message, "success");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Nao foi possivel iniciar a atualizacao.", "error");
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-section">
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Atualizacoes</h2>
      <p className="settings-section-desc">
        Versao instalada, novidades disponiveis e historico de versoes -- consultando as
        releases publicas do projeto no GitHub.
      </p>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="flex-row gap-sm" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Versao atual</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatVersion(status?.current_version)}</div>
          </div>
          {status?.has_update ? (
            <span className="badge" style={{ background: "var(--color-accent)", color: "#fff" }}>
              Nova versao disponivel
            </span>
          ) : status?.check_failed ? (
            <span className="badge" title="Nao foi possivel consultar o GitHub agora">
              Nao foi possivel verificar
            </span>
          ) : (
            <span className="badge">Atualizado</span>
          )}
        </div>

        {status?.has_update && status.latest && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <div className="flex-row gap-sm" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <strong>v{status.latest.version}</strong> — {status.latest.name}
                {status.latest.published_at && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
                    {formatDateTime(status.latest.published_at)}
                  </span>
                )}
              </div>
              {status.auto_update_enabled ? (
                <button className="btn btn-primary btn-sm" onClick={() => setConfirmOpen(true)} disabled={applying}>
                  {applying ? "Atualizando..." : "Atualizar agora"}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                  Atualizacao automatica desligada
                </span>
              )}
            </div>

            {status.latest.changelog && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                  color: "var(--color-text-muted)",
                  marginTop: 12,
                  marginBottom: 0,
                }}
              >
                {status.latest.changelog}
              </pre>
            )}

            {!status.auto_update_enabled && (
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 12, marginBottom: 0 }}>
                Para o botao atualizar sozinho, defina <code>ENABLE_AUTO_UPDATE=true</code> no{" "}
                <code>.env</code> (ver README). Sem isso, atualize manualmente com{" "}
                <code>docker compose pull && docker compose up -d</code> -- seus dados, uploads e
                segredos ficam em volumes separados e nao sao afetados.
              </p>
            )}
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Historico de versoes</h3>
      <p className="settings-section-desc" style={{ marginTop: -8, marginBottom: 12 }}>
        Clique numa versao pra ver o que mudou.
      </p>
      {history.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhuma release encontrada.</p>
      ) : (
        <div className="card release-list">
          {history.map((release) => {
            const isOpen = expandedVersions.has(release.version);
            return (
              <div className="release-item" key={release.version}>
                <button
                  type="button"
                  className="release-item-header"
                  onClick={() => toggleExpanded(release.version)}
                  aria-expanded={isOpen}
                >
                  <span className={`release-item-chevron ${isOpen ? "is-open" : ""}`}>▶</span>
                  <span style={{ flex: 1 }}>
                    <strong>v{release.version}</strong> — {release.name}
                    {release.is_current && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        atual
                      </span>
                    )}
                  </span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                    {release.published_at ? formatDateTime(release.published_at) : "--"}
                  </span>
                </button>
                <div className={`release-item-body ${isOpen ? "is-open" : ""}`}>
                  <div>
                    <pre className="release-item-changelog">
                      {release.changelog || "Sem changelog nesta release."}
                    </pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmOpen && status?.latest && (
        <ConfirmDialog
          title="Atualizar o sistema"
          message={`Isso vai atualizar de v${status.current_version} para v${status.latest.version} e reiniciar os containers. Banco de dados, uploads e segredos continuam intactos. O sistema pode ficar indisponivel por alguns instantes.`}
          confirmLabel="Atualizar agora"
          onConfirm={handleApply}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
