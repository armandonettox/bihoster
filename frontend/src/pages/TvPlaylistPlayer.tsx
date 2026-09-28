import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as workspacesApi from "../api/workspaces";
import * as reportsApi from "../api/reports";
import type { Report } from "../api/reports";
import ReportEmbed from "../components/ReportEmbed";
import { extractErrorMessage } from "../api/client";

export default function TvPlaylistPlayer() {
  const { workspaceId } = useParams();
  const id = Number(workspaceId);

  const [collectionName, setCollectionName] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(15);
  const [queue, setQueue] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [workspace, reports] = await Promise.all([
          workspacesApi.listWorkspaces().then((all) => all.find((w) => w.id === id)),
          reportsApi.listReports(id),
        ]);
        if (cancelled) return;
        if (!workspace) {
          setError("Colecao nao encontrada ou voce nao tem acesso a ela.");
          return;
        }
        setCollectionName(workspace.name);
        setIntervalSeconds(workspace.tv_interval_seconds);
        setQueue(reports.filter((r) => r.display_type === "tv"));
      } catch (err: any) {
        if (!cancelled) setError(extractErrorMessage(err) || "Nao foi possivel carregar o modo TV desta colecao.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (queue.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % queue.length);
    }, intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [queue.length, intervalSeconds]);

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
        <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
          {index + 1} / {queue.length}
        </span>
      </div>
      <div className="fullscreen-view-body">
        <ReportEmbed key={current.id} reportId={current.id} workspaceId={id} height="100%" />
      </div>
    </div>
  );
}
