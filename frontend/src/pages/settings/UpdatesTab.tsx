import { useEffect, useState } from "react";
import * as systemApi from "../../api/system";
import type { ReleaseInfo, VersionStatus } from "../../api/system";
import ChangelogMarkdown from "../../components/ChangelogMarkdown";
import ConfirmDialog from "../../components/ConfirmDialog";
import { SkeletonCard } from "../../components/Skeleton";
import { useAccess } from "../../context/AccessContext";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";
import { formatDate } from "../../utils/datetime";

// Quantas versões aparecem de cara; as mais antigas ficam atrás de "Mostrar versões anteriores"
const VISIBLE_VERSIONS = 10;

// "dev" e o build local (docker-compose.dev.yml, sem tag de release) -- prefixar com "v"
// vira "vdev", que confunde. So versoes numericas de release ganham o "v" na frente.
function formatVersion(version: string | undefined): string {
  if (!version) return "";
  return version === "dev" ? "dev (build local)" : `v${version}`;
}

export default function UpdatesTab() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [history, setHistory] = useState<ReleaseInfo[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  // Ver a versao e o historico tem permissao propria; aplicar a atualizacao mexe no servidor e e so do administrador da plataforma
  const isAdmin = useAccess().isAdmin;
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

  useEffect(() => {
    Promise.all([
      systemApi
        .getVersionStatus()
        .then(setStatus)
        .catch(() => showToast("Não foi possível verificar atualizações agora.", "error")),
      systemApi
        .getVersionHistory()
        .then((releases) => {
          setHistory(releases);
          // Abre a versao instalada (ou, sem ela na lista, a mais recente): e a que a pessoa quer ler primeiro
          const open = releases.find((r) => r.is_current) ?? releases[0];
          if (open) setExpandedVersions(new Set([open.version]));
        })
        .catch(() => setHistoryFailed(true)),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Verificar atualizacoes": ignora a resposta guardada e consulta o GitHub de novo
  async function handleCheck() {
    setChecking(true);
    try {
      const fresh = await systemApi.getVersionStatus(true);
      setStatus(fresh);
      if (fresh.check_failed) showToast("Não foi possível consultar o GitHub agora.", "error");
      else if (fresh.has_update && fresh.latest) showToast(`Nova versão disponível: v${fresh.latest.version}.`);
      else showToast("Você já está na versão mais recente.");
    } catch {
      showToast("Não foi possível verificar atualizações agora.", "error");
    } finally {
      setChecking(false);
    }
  }

  async function handleApply() {
    setConfirmOpen(false);
    setApplying(true);
    try {
      const result = await systemApi.applyUpdate();
      showToast(result.message, "success");
    } catch (err) {
      showToast(extractErrorMessage(err) || "Não foi possível iniciar a atualização.", "error");
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

  const hasUpdate = Boolean(status?.has_update && status.latest);
  const autoUpdate = Boolean(status?.auto_update_enabled);
  const canApply = hasUpdate && autoUpdate && isAdmin && !applying;
  // Por que o botao de atualizar esta desligado (ele aparece sempre, para o administrador saber onde fica)
  const applyHint = !hasUpdate
    ? "Você já está na versão mais recente."
    : !autoUpdate
      ? "A atualização automática está desligada neste servidor."
      : !isAdmin
        ? "Só o administrador da plataforma aplica a atualização."
        : null;

  const visible = showAll ? history : history.slice(0, VISIBLE_VERSIONS);
  const hidden = history.length - visible.length;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Atualizações</h2>
      <p className="settings-section-desc">
        Versão instalada, novidades disponíveis e o histórico de tudo o que mudou em cada versão.
      </p>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="flex-row gap-sm" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Versão atual</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatVersion(status?.current_version)}</div>
          </div>
          <div className="flex-row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
            {hasUpdate ? (
              <span className="badge" style={{ background: "var(--color-accent)", color: "#fff" }}>
                Nova versão disponível
              </span>
            ) : status?.check_failed ? (
              <span className="badge" title="Não foi possível consultar o GitHub agora">
                Não foi possível verificar
              </span>
            ) : (
              <span className="badge">Atualizado</span>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCheck()} disabled={checking}>
              {checking ? "Verificando..." : "Verificar atualizações"}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setConfirmOpen(true)}
                disabled={!canApply}
                title={applyHint ?? undefined}
              >
                {applying ? "Atualizando..." : "Atualizar agora"}
              </button>
            )}
          </div>
        </div>
        {isAdmin && applyHint && (
          <p className="field-hint" style={{ margin: "10px 0 0", textAlign: "right" }}>
            {applyHint}
          </p>
        )}

        {hasUpdate && status?.latest && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 16 }}>
            <div>
              <strong>v{status.latest.version}</strong> — {status.latest.name}
              {status.latest.published_at && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
                  {formatDate(status.latest.published_at)}
                </span>
              )}
            </div>

            {status.latest.changelog && (
              <div style={{ marginTop: 12 }}>
                <ChangelogMarkdown text={status.latest.changelog} />
              </div>
            )}

            {!autoUpdate && (
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 12, marginBottom: 0 }}>
                Para o botão atualizar sozinho, defina <code>ENABLE_AUTO_UPDATE=true</code> no <code>.env</code> (ver
                README). Sem isso, atualize manualmente com <code>docker compose pull && docker compose up -d</code> --
                seus dados, uploads e segredos ficam em volumes separados e não são afetados.
              </p>
            )}
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Histórico de versões</h3>
      <p className="settings-section-desc" style={{ marginTop: -8, marginBottom: 12 }}>
        Clique numa versão para ver o que mudou.
      </p>
      {historyFailed ? (
        <p className="auth-error">Não foi possível carregar o histórico de versões.</p>
      ) : history.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>Nenhuma versão encontrada.</p>
      ) : (
        <>
          <div className="card release-list">
            {visible.map((release) => {
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
                      {release.published_at ? formatDate(release.published_at) : "--"}
                    </span>
                  </button>
                  <div className={`release-item-body ${isOpen ? "is-open" : ""}`}>
                    <div>
                      <div className="release-item-changelog">
                        {isOpen &&
                          (release.changelog ? (
                            <ChangelogMarkdown text={release.changelog} />
                          ) : (
                            <p className="field-hint">Sem notas nesta versão.</p>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hidden > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setShowAll(true)}>
              Mostrar versões anteriores ({hidden})
            </button>
          )}
        </>
      )}

      {confirmOpen && status?.latest && (
        <ConfirmDialog
          title="Atualizar o sistema"
          message={`Isso vai atualizar de v${status.current_version} para v${status.latest.version} e reiniciar os containers. Banco de dados, uploads e segredos continuam intactos. O sistema pode ficar indisponível por alguns instantes.`}
          confirmLabel="Atualizar agora"
          onConfirm={handleApply}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
