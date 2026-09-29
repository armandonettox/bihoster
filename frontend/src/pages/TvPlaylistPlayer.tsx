import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as workspacesApi from "../api/workspaces";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import ReportEmbed from "../components/ReportEmbed";
import SlideshowControls from "../components/SlideshowControls";
import SlideshowProgress from "../components/SlideshowProgress";
import { useSlideshow } from "../hooks/useSlideshow";
import { useSlideshowKeys } from "../hooks/useSlideshowKeys";
import { extractErrorMessage } from "../api/client";

const PLAYLIST_REFRESH_MS = 3 * 60 * 1000;

/** Mesma playlist? Compara id, nome e conexao dos relatorios, na mesma ordem. */
function sameQueue(a: Report[], b: Report[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (report, i) =>
      report.id === b[i].id &&
      report.name === b[i].name &&
      report.pbi_page_name === b[i].pbi_page_name &&
      report.powerbi_connection_id === b[i].powerbi_connection_id,
  );
}

export default function TvPlaylistPlayer() {
  const { workspaceId } = useParams();
  const id = Number(workspaceId);

  const [collectionName, setCollectionName] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(15);
  const [queue, setQueue] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // `silent`: recarga periodica em segundo plano. Nao mostra "carregando", nao troca a tela por
    // erro se falhar (a TV segue mostrando o que ja tem) e so mexe no estado se algo mudou.
    async function load(silent: boolean) {
      try {
        const [workspace, reports] = await Promise.all([
          workspacesApi.listWorkspaces().then((all) => all.find((w) => w.id === id)),
          reportsApi.listReports(id),
        ]);
        if (cancelled) return;
        if (!workspace) {
          if (!silent) setError("Colecao nao encontrada ou voce nao tem acesso a ela.");
          return;
        }
        setCollectionName(workspace.name);
        setIntervalSeconds(workspace.tv_interval_seconds);
        const nextQueue = reports.filter((r) => r.display_type === "tv");
        // Mantem o mesmo array quando a lista nao mudou: trocar a referencia reiniciaria o
        // temporizador de rotacao a cada recarga.
        setQueue((current) => (sameQueue(current, nextQueue) ? current : nextQueue));
      } catch (err: any) {
        if (!cancelled && !silent) {
          setError(extractErrorMessage(err) || "Nao foi possivel carregar o modo TV desta colecao.");
        }
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    }

    load(false);
    // Uma TV fica ligada por dias: sem isso, editar a lista ou o intervalo nunca chegava a ela.
    const refreshTimer = setInterval(() => load(true), PLAYLIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, [id]);

  // Rotacao, pausa e navegacao manual: setas navegam e Espaco pausa/retoma
  const slideshow = useSlideshow({ count: queue.length, intervalMs: intervalSeconds * 1000, autoAdvance: true });
  const { index } = slideshow;
  useSlideshowKeys({ onNext: slideshow.next, onPrev: slideshow.prev, onTogglePause: slideshow.togglePause });

  if (loading) {
    return (
      <div className="fullscreen-view">
        <p style={{ padding: 20, color: "var(--color-text-muted)" }}>Carregando modo TV...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fullscreen-view">
        <p style={{ padding: 20, color: "var(--color-danger)" }}>{error}</p>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="fullscreen-view">
        <p style={{ padding: 20, color: "var(--color-text-muted)" }}>
          Essa colecao ainda nao tem nenhum relatorio marcado como Modo TV.
        </p>
      </div>
    );
  }

  const current = queue[index];

  return (
    <div className="fullscreen-view">
      <div className="fullscreen-view-header">
        <div>
          <span style={{ fontWeight: 700 }}>{collectionName}</span>
          <span style={{ color: "var(--color-text-muted)", marginLeft: 10 }}>{current.name}</span>
        </div>
        <SlideshowControls
          index={index}
          count={queue.length}
          paused={slideshow.paused}
          onPrev={slideshow.prev}
          onNext={slideshow.next}
          onTogglePause={slideshow.togglePause}
        />
      </div>
      {queue.length > 1 && <SlideshowProgress countdown={slideshow.countdown} paused={slideshow.paused} />}
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} workspaceId={id} height="100%" />
      </div>
    </div>
  );
}
