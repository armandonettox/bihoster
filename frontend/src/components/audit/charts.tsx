/** Graficos da auditoria em SVG puro (sem biblioteca). O texto fica em HTML, fora do SVG,
 * para nao distorcer quando o grafico estica na largura.
 *
 * Todos mostram um rotulo com o valor ao passar o cursor. Quando recebem `onSelect`, clicar num
 * item o seleciona (a tela aplica como filtro) e `selected` destaca o que ja esta selecionado. */

import { shortDate } from "../../utils/auditPeriod";
import { useChartTooltip } from "./chartTooltip";

const CLICK_HINT = "Clique para filtrar";
const UNSELECT_HINT = "Clique para tirar o filtro";

interface Selectable {
  /** Clicar num item o seleciona (filtra). Sem isto, o grafico so mostra o rotulo. */
  onSelect?: (key: string) => void;
  /** Itens que ja estao selecionados (filtrados) */
  selected?: string[];
}

const hintFor = (props: Selectable, key: string): string | undefined =>
  props.onSelect ? (props.selected?.includes(key) ? UNSELECT_HINT : CLICK_HINT) : undefined;

const dimmed = (props: Selectable, key: string) => (props.selected && props.selected.length > 0 && !props.selected.includes(key) ? " chart-dim" : "");
const picked = (props: Selectable, key: string) => (props.selected?.includes(key) ? " chart-selected" : "");

interface LineChartProps extends Selectable {
  /** `label` e a chave do ponto (para o dia, a data 2026-11-10) */
  data: { label: string; value: number }[];
  /** Descricao do valor de um ponto no rotulo, ex: "12 eventos" */
  describe: (value: number) => string;
  /** Como mostrar o rotulo de cada ponto; o padrao trata como data (2026-11-10 vira 10/11) */
  formatLabel?: (label: string) => string;
}

/** Linha com area, uma coluna invisivel por ponto para o rotulo e o clique de cada dia. */
export function LineChart({ data, describe, formatLabel = shortDate, onSelect, selected }: LineChartProps) {
  const { bind, element } = useChartTooltip();
  const width = 600;
  const height = 180;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const x = (i: number) => (data.length > 1 ? i * step : width / 2);
  const y = (v: number) => height - 6 - (v / max) * (height - 16);
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = data.length > 0 ? `0,${height} ${points} ${width},${height}` : "";
  const colWidth = data.length > 0 ? width / data.length : width;
  const state = { onSelect, selected };

  return (
    <div className="audit-line">
      <div className="audit-line-max">{max}</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Grafico de linha">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={width} y1={height * f} y2={height * f} className="audit-grid-line" vectorEffect="non-scaling-stroke" />
        ))}
        {data.length > 1 && <polygon points={area} className="audit-line-area" />}
        {data.length > 1 && <polyline points={points} className="audit-line-stroke" vectorEffect="non-scaling-stroke" />}
        {data.length === 1 && <circle cx={x(0)} cy={y(data[0].value)} r="4" className="audit-line-dot" />}
        {data.map((d, i) => (
          <rect
            key={d.label}
            x={i * colWidth}
            y="0"
            width={colWidth}
            height={height}
            className={`audit-line-hit${onSelect ? " chart-clickable" : ""}${picked(state, d.label)}`}
            onClick={onSelect ? () => onSelect(d.label) : undefined}
            {...bind({ title: formatLabel(d.label), value: describe(d.value), hint: hintFor(state, d.label) })}
          />
        ))}
      </svg>
      {data.length > 0 && (
        <div className="audit-line-axis">
          <span>{formatLabel(data[0].label)}</span>
          {data.length > 2 && <span>{formatLabel(data[Math.floor((data.length - 1) / 2)].label)}</span>}
          {data.length > 1 && <span>{formatLabel(data[data.length - 1].label)}</span>}
        </div>
      )}
      {element}
    </div>
  );
}

interface BarListProps extends Selectable {
  items: { key: string; label: string; value: number; hint?: string }[];
  unit: (value: number) => string;
}

/** Barras horizontais com o nome e o valor, a maior ocupa a largura toda. */
export function BarList({ items, unit, onSelect, selected }: BarListProps) {
  const { bind, element } = useChartTooltip();
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = items.reduce((total, i) => total + i.value, 0);
  const state = { onSelect, selected };

  return (
    <ul className="audit-barlist">
      {items.map((item) => {
        const share = sum > 0 ? Math.round((item.value / sum) * 100) : 0;
        const tip = bind({
          title: item.label,
          value: items.length > 1 ? `${unit(item.value)} (${share}%)` : unit(item.value),
          hint: [item.hint, hintFor(state, item.key)].filter(Boolean).join(" · ") || undefined,
        });
        const content = (
          <>
            <div className="audit-barlist-head">
              <span className="audit-barlist-label">{item.label}</span>
              <span className="audit-barlist-value">{unit(item.value)}</span>
            </div>
            <div className="audit-barlist-track">
              <div className="audit-barlist-fill" style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={item.key} className={`audit-barlist-item${picked(state, item.key)}${dimmed(state, item.key)}`} {...tip}>
            {onSelect ? (
              <button type="button" className="audit-barlist-row chart-clickable" onClick={() => onSelect(item.key)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
      {element}
    </ul>
  );
}

/** 24 colunas, uma por hora do dia; a hora de pico fica destacada. */
export function HourChart({ values, describe }: { values: number[]; describe: (hour: number, value: number) => string }) {
  const { bind, element } = useChartTooltip();
  const max = Math.max(1, ...values);
  const peak = values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : -1;
  return (
    <div className="audit-hours">
      <div className="audit-hours-bars">
        {values.map((value, hour) => (
          <div key={hour} className="audit-hours-col" {...bind({ title: `${hour}h`, value: describe(hour, value) })}>
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
      {element}
    </div>
  );
}

interface DonutProps extends Selectable {
  parts: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  emptyText: string;
}

export function Donut({ parts, centerLabel, emptyText, onSelect, selected }: DonutProps) {
  const { bind, element } = useChartTooltip();
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) return <p className="audit-empty">{emptyText}</p>;

  const state = { onSelect, selected };
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const share = (value: number) => Math.round((value / total) * 100);
  const tipFor = (part: DonutProps["parts"][number]) =>
    bind({ title: part.label, value: `${part.value.toLocaleString("pt-BR")} (${share(part.value)}%)`, hint: hintFor(state, part.key) });

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
              className={`audit-donut-slice${onSelect ? " chart-clickable" : ""}${picked(state, part.key)}${dimmed(state, part.key)}`}
              onClick={onSelect ? () => onSelect(part.key) : undefined}
              {...tipFor(part)}
            />
          ))}
        </svg>
        <div className="audit-donut-center">
          <strong>{total}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="audit-donut-legend">
        {parts.map((part) => {
          const content = (
            <>
              <span className="audit-dot" style={{ backgroundColor: part.color }} />
              {part.label}
              <strong>{part.value}</strong>
            </>
          );
          return (
            <li key={part.key} className={`${picked(state, part.key)}${dimmed(state, part.key)}`.trim()} {...tipFor(part)}>
              {onSelect ? (
                <button type="button" className="audit-donut-legend-item chart-clickable" onClick={() => onSelect(part.key)}>
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
      {element}
    </div>
  );
}
