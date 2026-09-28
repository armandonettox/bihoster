import { useEffect, useState } from "react";
import * as reportsApi from "../api/reports";
import { formatDateTime } from "../utils/datetime";

export default function ReportRefreshInfo({ workspaceId, reportId }: { workspaceId: number; reportId: number }) {
  const [info, setInfo] = useState<reportsApi.RefreshInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    reportsApi
      .getRefreshInfo(workspaceId, reportId)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, reportId]);

  if (!info || (!info.last_refresh && !info.next_refresh)) return null;

  return (
    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
      {info.last_refresh && <>Ultima atualizacao: {formatDateTime(info.last_refresh)}</>}
      {info.last_refresh && info.next_refresh && " · "}
      {info.next_refresh && <>Proxima: {formatDateTime(info.next_refresh)}</>}
    </span>
  );
}
