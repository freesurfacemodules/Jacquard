import { useMemo, useRef } from "react";

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
const MAX_POINTS = 512;
const TARGET_REFRESH_HZ = 90;
const REFRESH_INTERVAL_MS = 1000 / TARGET_REFRESH_HZ;
const MAX_VERTICAL_LINES = 20;
const MAX_HORIZONTAL_LINES = 9;

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

function buildPlotData(
  samples: Float32Array,
  sampleInterval: number,
  scale: number,
  requestedTime: number,
  mode: number,
  coverage: number
): PlotData {
  const safeScale = clamp(Math.abs(scale), 0.1, 20);
  const triggered = mode !== 0;
  const hold = mode === 2;
  const available = samples.length;
  if (available === 0) {
    return { points: "", grid: [], triggered, hold, coverage: 0 };
  }

  const step = Math.max(1, Math.floor(available / MAX_POINTS));
  const lastIndex = available - 1;
  const normalized: string[] = [];
  for (let i = 0; i < available; i += step) {
    const sample = samples[i];
    const clamped = clamp(sample, -safeScale, safeScale);
    const x = lastIndex > 0 ? i / lastIndex : 0;
    const y = 0.5 - clamped / (safeScale * 2);
    const px = Math.round(x * VIEWBOX_WIDTH * 10) / 10;
    const py = Math.round(clamp(y, 0, 1) * VIEWBOX_HEIGHT * 10) / 10;
    normalized.push(`${px},${py}`);
  }
  if (normalized.length === 0 || !normalized[normalized.length - 1].startsWith(`${VIEWBOX_WIDTH},`)) {
    const finalSample = samples[lastIndex];
    const clamped = clamp(finalSample, -safeScale, safeScale);
    const y = 0.5 - clamped / (safeScale * 2);
    const py = Math.round(clamp(y, 0, 1) * VIEWBOX_HEIGHT * 10) / 10;
    normalized.push(`${VIEWBOX_WIDTH},${py}`);
  }

  const grid: GridLine[] = [];

  const maxVolts = Math.ceil(safeScale);
  const horizontalStep = Math.max(1, Math.ceil(maxVolts / MAX_HORIZONTAL_LINES));
  for (let volt = -maxVolts; volt <= maxVolts; volt += horizontalStep) {
    const y = 0.5 - volt / (safeScale * 2);
    const py = clamp(y, 0, 1) * VIEWBOX_HEIGHT;
    grid.push({ x: 0, y: py, type: "horizontal", value: volt });
  }

  const timeSpan = Math.max(requestedTime, coverage, samples.length * sampleInterval, EPSILON);
  const totalMs = timeSpan * 1000;
  const verticalDivisions = Math.max(1, Math.min(MAX_VERTICAL_LINES, Math.round(totalMs)));
  const stepMs = totalMs / verticalDivisions;
  for (let i = 0; i <= verticalDivisions; i++) {
    const ms = stepMs * i;
    const x = clamp(ms / totalMs, 0, 1) * VIEWBOX_WIDTH;
    grid.push({ x, y: 0, type: "vertical", value: Math.round(ms) });
  }

  return {
    points: normalized.join(" "),
    grid,
    triggered,
    hold,
    coverage: timeSpan
  };
}

export function ScopeVisualizer({
  samples,
  sampleInterval,
  scale,
  requestedTime,
  mode,
  coverage
}: ScopeVisualizerProps): JSX.Element {
  const lastFrameRef = useRef<number>(0);
  const lastDataRef = useRef<PlotData | null>(null);

  const data = useMemo<PlotData>(() => {
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const elapsed = now - lastFrameRef.current;
    if (lastDataRef.current && elapsed < REFRESH_INTERVAL_MS) {
      return lastDataRef.current;
    }

    const computed = buildPlotData(samples, sampleInterval, scale, requestedTime, mode, coverage);
    lastFrameRef.current = now;
    lastDataRef.current = computed;
    return computed;
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
