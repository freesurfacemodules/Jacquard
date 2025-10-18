import { useMemo } from "react";

interface ScopeVisualizerProps {
  samples: Float32Array;
  sampleInterval: number;
  scale: number;
  requestedTime: number;
  mode: number;
  coverage: number;
}

const VIEWBOX_WIDTH = 220;
const VIEWBOX_HEIGHT = 120;
const EPSILON = 1e-6;

interface GridLine {
  x: number;
  y: number;
  type: "vertical" | "horizontal";
  value: number;
}

interface PlotData {
  points: string;
  grid: GridLine[];
  triggered: boolean;
  hold: boolean;
  coverage: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function ScopeVisualizer({
  samples,
  sampleInterval,
  scale,
  requestedTime,
  mode,
  coverage
}: ScopeVisualizerProps): JSX.Element {
  const data = useMemo<PlotData>(() => {
    const safeScale = clamp(Math.abs(scale), 0.1, 20);
    const triggered = mode !== 0;
    const hold = mode === 2;
    const available = samples.length;
    if (available === 0) {
      return { points: "", grid: [], triggered, hold, coverage: 0 };
    }

    const normalized: string[] = [];
    for (let i = 0; i < samples.length; i++) {
      const x = samples.length <= 1 ? 0 : i / (samples.length - 1);
      const yValue = clamp(samples[i], -safeScale, safeScale);
      const y = 0.5 - yValue / (safeScale * 2);
      const px = x * VIEWBOX_WIDTH;
      const py = clamp(y, 0, 1) * VIEWBOX_HEIGHT;
      normalized[i] = `${px.toFixed(2)},${py.toFixed(2)}`;
    }

    const grid: GridLine[] = [];

    // Horizontal grid lines (1V increments)
    const maxVolts = Math.ceil(safeScale);
    for (let volt = -maxVolts; volt <= maxVolts; volt++) {
      const y = 0.5 - volt / (safeScale * 2);
      const py = clamp(y, 0, 1) * VIEWBOX_HEIGHT;
      grid.push({ x: 0, y: py, type: "horizontal", value: volt });
    }

    // Vertical grid lines (1ms increments)
    const timeSpan = Math.max(requestedTime, coverage, samples.length * sampleInterval, EPSILON);
    const totalMs = timeSpan * 1000;
    const divisions = Math.min(100, Math.ceil(totalMs));
    for (let i = 0; i <= divisions; i++) {
      const ms = i;
      const x = clamp(ms / totalMs, 0, 1) * VIEWBOX_WIDTH;
      grid.push({ x, y: 0, type: "vertical", value: ms });
    }

    return {
      points: normalized.join(" "),
      grid,
      triggered,
      hold,
      coverage: timeSpan
    };
  }, [samples, sampleInterval, scale, requestedTime, mode, coverage]);

  return (
    <div className="scope-visualizer" aria-label="Oscilloscope">
      <svg
        className="scope-visualizer__svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <rect
          className="scope-visualizer__background"
          x={0}
          y={0}
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
          rx={6}
        />
        {data.grid.map((line, index) =>
          line.type === "horizontal" ? (
            <line
              key={`h-${index}`}
              className="scope-visualizer__grid"
              x1={0}
              y1={line.y}
              x2={VIEWBOX_WIDTH}
              y2={line.y}
            />
          ) : (
            <line
              key={`v-${index}`}
              className="scope-visualizer__grid scope-visualizer__grid--vertical"
              x1={line.x}
              y1={0}
              x2={line.x}
              y2={VIEWBOX_HEIGHT}
            />
          )
        )}
        {data.points ? (
          <polyline
            className={
              data.hold
                ? "scope-visualizer__curve scope-visualizer__curve--hold"
                : data.triggered
                ? "scope-visualizer__curve scope-visualizer__curve--triggered"
                : "scope-visualizer__curve"
            }
            fill="none"
            strokeWidth={2}
            points={data.points}
          />
        ) : null}
      </svg>
    </div>
  );
}
