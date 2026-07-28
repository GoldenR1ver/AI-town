import { useMemo } from "react";

export interface ChartSeries {
  name: string;
  values: number[];
  color: string;
}

interface MiniLineChartProps {
  title: string;
  labels: string[];
  series: ChartSeries[];
  height?: number;
  valuePrefix?: string;
  /** When true, y domain starts at 0. */
  fromZero?: boolean;
}

function niceDomain(values: number[], fromZero: boolean): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (fromZero) min = Math.min(0, min);
  if (Math.abs(max - min) < 1e-9) {
    max = min + 1;
    if (fromZero) min = 0;
  }
  const pad = (max - min) * 0.08;
  return [min - (fromZero && min >= 0 ? 0 : pad), max + pad];
}

export function MiniLineChart({
  title,
  labels,
  series,
  height = 140,
  valuePrefix = "",
  fromZero = false,
}: MiniLineChartProps) {
  const width = 420;
  const padL = 36;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allValues = series.flatMap((item) => item.values);
  const [yMin, yMax] = niceDomain(allValues, fromZero);
  const n = Math.max(labels.length, 1);

  const xAt = (index: number) =>
    padL + (n <= 1 ? innerW / 2 : (index / (n - 1)) * innerW);
  const yAt = (value: number) =>
    padT + ((yMax - value) / Math.max(yMax - yMin, 1e-9)) * innerH;

  const tickIdx = useMemo(() => {
    if (n <= 5) return [...Array(n).keys()];
    const picks = new Set<number>([0, n - 1]);
    const mid = Math.floor((n - 1) / 2);
    picks.add(mid);
    picks.add(Math.floor(mid / 2));
    picks.add(Math.floor((mid + n - 1) / 2));
    return [...picks].sort((a, b) => a - b);
  }, [n]);

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div className="mini-chart">
      <div className="mini-chart-head">
        <strong>{title}</strong>
        <div className="mini-chart-legend">
          {series.map((item) => (
            <span key={item.name}>
              <i style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mini-chart-svg"
        role="img"
        aria-label={title}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={padL}
              x2={width - padR}
              y1={yAt(tick)}
              y2={yAt(tick)}
              className="mini-chart-grid"
            />
            <text x={padL - 4} y={yAt(tick) + 3} className="mini-chart-ytick">
              {valuePrefix}
              {Math.abs(tick) >= 1000
                ? `${(tick / 1000).toFixed(1)}k`
                : tick.toFixed(tick < 2 ? 2 : 0)}
            </text>
          </g>
        ))}
        {series.map((item) => {
          const points = item.values
            .map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`)
            .join(" ");
          return (
            <g key={item.name}>
              <polyline
                fill="none"
                stroke={item.color}
                strokeWidth={1.8}
                points={points}
              />
              {item.values.map((value, index) => (
                <circle
                  key={`${item.name}-${index}`}
                  cx={xAt(index)}
                  cy={yAt(value)}
                  r={1.6}
                  fill={item.color}
                >
                  <title>
                    {labels[index]} · {item.name}: {valuePrefix}
                    {value.toFixed(2)}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {tickIdx.map((index) => (
          <text
            key={`x-${index}`}
            x={xAt(index)}
            y={height - 8}
            className="mini-chart-xtick"
          >
            {labels[index]}
          </text>
        ))}
      </svg>
    </div>
  );
}
