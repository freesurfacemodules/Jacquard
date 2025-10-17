import { useMemo } from "react";

interface ScopeVisualizerProps {
  samples: Float32Array;
  count: number;
  writeIndex: number;
  scale: number;
  time: number;
  mode: number;
  captured: number;
  capacity: number;
}

const VIEWBOX_WIDTH = 220;
const VIEWBOX_HEIGHT = 120;
const MIN_DISPLAY_SAMPLES = 16;
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
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function ScopeVisualizer({
  samples,
  count,
  writeIndex,
  scale,
  time,
  mode,
  captured,
  capacity
}: ScopeVisualizerProps): JSX.Element {
  const data = useMemo<PlotData>(() => {
    const safeScale = clamp(Math.abs(scale), 0.1, 20);
    const windowSamples = Math.max(count, MIN_DISPLAY_SAMPLES);
    const effectiveCapacity = Math.max(capacity, samples.length);
    const triggered = mode === 1;

    const available = samples.length;
    if (available === 0 || windowSamples === 0) {
      return { points: "", grid: [], triggered };
    }

    const maxSamples = Math.min(windowSamples, available);
    const displaySamples = triggered
      ? Math.max(1, Math.min(maxSamples, Math.floor(captured)))
      : maxSamples;

    const result: number[] = new Array(displaySamples);

    if (triggered) {
      for (let i = 0; i < displaySamples; i++) {
        result[i] = samples[i] ?? 0;
      }
    } else {
      const ringCapacity = effectiveCapacity > 0 ? effectiveCapacity : available;
      const endIndex = ((writeIndex % ringCapacity) + ringCapacity) % ringCapacity;
      let startIndex = endIndex - displaySamples;
      while (startIndex < 0) {
        startIndex += ringCapacity;
      }
      for (let i = 0; i < displaySamples; i++) {
        const sourceIndex = (startIndex + i) % ringCapacity;
        result[i] = samples[sourceIndex] ?? 0;
      }
    }

    const normalized: string[] = new Array(displaySamples);
    for (let i = 0; i < displaySamples; i++) {
      const x = displaySamples <= 1 ? 0 : i / (displaySamples - 1);
      const yValue = clamp(result[i], -safeScale, safeScale);
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
    const totalMs = Math.max(time * 1000, EPSILON);
    const divisions = Math.min(100, Math.ceil(totalMs));
    for (let i = 0; i <= divisions; i++) {
      const ms = i;
      const x = clamp(ms / totalMs, 0, 1) * VIEWBOX_WIDTH;
      grid.push({ x, y: 0, type: "vertical", value: ms });
    }

    return {
      points: normalized.join(" "),
      grid,
      triggered
    };
  }, [samples, count, writeIndex, scale, time, mode, captured, capacity]);

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
            className="scope-visualizer__curve"
            fill="none"
            strokeWidth={2}
            points={data.points}
          />
        ) : null}
      </svg>
    </div>
  );
}
