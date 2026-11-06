import { useEffect, useRef, useState } from "react";
import ReportEmbed from "./ReportEmbed";

const NATIVE_WIDTH = 1280;
const NATIVE_HEIGHT = 720;

export default function ReportThumbnail({
  reportId,
  thumbnailUrl,
}: {
  reportId: number;
  thumbnailUrl?: string | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setScale(width / NATIVE_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        loading="lazy"
      />
    );
  }

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      {scale > 0 && (
        <div
          style={{
            width: NATIVE_WIDTH,
            height: NATIVE_HEIGHT,
            overflow: "hidden",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <ReportEmbed reportId={reportId} height={NATIVE_HEIGHT} />
        </div>
      )}
    </div>
  );
}
