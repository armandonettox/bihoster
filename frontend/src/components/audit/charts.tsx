/** Graficos da auditoria em SVG puro (sem biblioteca). O texto fica em HTML, fora do SVG,
 * para nao distorcer quando o grafico estica na largura. */

import { shortDate } from "../../utils/auditPeriod";

interface LineChartProps {
  data: { label: string; value: number }[];
  /** Descricao de um ponto na dica ao passar o cursor, ex: "12 eventos" */
  describe: (value: number) => string;
  /** Como mostrar o rotulo de cada ponto; o padrao trata como data (2026-11-10 vira 10/11) */
  formatLabel?: (label: string) => string;
}

/** Linha com area, uma coluna invisivel por ponto para a dica de cada dia. */
export function LineChart({ data, describe, formatLabel = shortDate }: LineChartProps) {
  const width = 600;
  const height = 180;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const x = (i: number) => (data.length > 1 ? i * step : width / 2);
  const y = (v: number) => height - 6 - (v / max) * (height - 16);
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = data.length > 0 ? `0,${height} ${points} ${width},${height}` : "";
  const colWidth = data.length > 0 ? width / data.length : width;

  return (
    <div className="audit-line">
      <div className="audit-line-max">{max}</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Eventos por dia">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} className="audit-grid-line" vectorEffect="non-scaling-stroke" />
        ))}
        {data.length > 1 && <polygon points={area} className="audit-line-area" />}
        {data.length > 1 && <polyline points={points} className="audit-line-stroke" vectorEffect="non-scaling-stroke" />}
        {data.length === 1 && <circle cx={x(0)} cy={y(data[0].value)} r="4" className="audit-line-dot" />}
        {data.map((d, i) => (
          <rect key={d.label} x={i * colWidth} y="0" width={colWidth} height={height} className="audit-line-hit">
            <title>{`${formatLabel(d.label)}: ${describe(d.value)}`}</title>
          </rect>
        ))}
      </svg>
      {data.length > 0 && (
        <div className="audit-line-axis">
          <span>{formatLabel(data[0].label)}</span>
          {data.length > 2 && <span>{formatLabel(data[Math.floor((data.length - 1) / 2)].label)}</span>}
          {data.length > 1 && <span>{formatLabel(data[data.length - 1].label)}</span>}
        </div>
      )}
    </div>
  );
}

interface BarListProps {
  items: { key: string; label: string; value: number; hint?: string }[];
  unit: (value: number) => string;
}

/** Barras horizontais com o nome e o valor, a maior ocupa a largura toda. */
export function BarList({ items, unit }: BarListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="audit-barlist">
      {items.map((item) => (
        <li key={item.key} title={item.hint}>
          <div className="audit-barlist-head">
            <span className="audit-barlist-label">{item.label}</span>
            <span className="audit-barlist-value">{unit(item.value)}</span>
          </div>
          <div className="audit-barlist-track">
            <div className="audit-barlist-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 24 colunas, uma por hora do dia; a hora de pico fica destacada. */
export function HourChart({ values, describe }: { values: number[]; describe: (hour: number, value: number) => string }) {
  const max = Math.max(1, ...values);
  const peak = values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : -1;
  return (
    <div className="audit-hours">
      <div className="audit-hours-bars">
        {values.map((value, hour) => (
          <div key={hour} className="audit-hours-col" title={describe(hour, value)}>
            <div
              className={`audit-hours-bar ${hour === peak ? "audit-hours-bar-peak" : ""}`}
              style={{ height: `${Math.max((value / max) * 100, value > 0 ? 4 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="audit-line-axis">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  );
}

interface DonutProps {
  parts: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  emptyText: string;
}

export function Donut({ parts, centerLabel, emptyText }: DonutProps) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) return <p className="audit-empty">{emptyText}</p>;

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  // Cada fatia comeca onde a anterior terminou
  const segments = parts
    .filter((p) => p.value > 0)
    .map((part, index, visible) => {
      const length = (part.value / total) * circumference;
      const offset = visible.slice(0, index).reduce((sum, p) => sum + (p.value / total) * circumference, 0);
      return { part, length, offset };
    });

  return (
    <div className="audit-donut">
      <div className="audit-donut-chart">
        <svg viewBox="0 0 100 100" role="img" aria-label={centerLabel}>
          <circle cx="50" cy="50" r={radius} fill="none" className="audit-donut-base" strokeWidth="14" />
          {segments.map(({ part, length, offset }) => (
            <circle
              key={part.key}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={part.color}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            >
              <title>{`${part.label}: ${part.value}`}</title>
            </circle>
          ))}
        </svg>
        <div className="audit-donut-center">
          <strong>{total}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="audit-donut-legend">
        {parts.map((part) => (
          <li key={part.key}>
            <span className="audit-dot" style={{ backgroundColor: part.color }} />
            {part.label}
            <strong>{part.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
