import { useMemo } from "react";

interface EnvelopeVisualizerProps {
  rise: number;
  fall: number;
  curve: number;
  value: number;
  progress: number;
}

const CURVE_SHAPE = 5;
const SAMPLE_COUNT = 64;
const EPSILON = 1e-6;
const VIEWBOX_WIDTH = 200;
const VIEWBOX_HEIGHT = 80;

interface Point {
  x: number;
  y: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function normalizeAttackCurve(progress: number): number {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }
  const numerator = 1 - Math.exp(-CURVE_SHAPE * progress);
  const denominator = 1 - Math.exp(-CURVE_SHAPE);
  return denominator !== 0 ? numerator / denominator : progress;
}

function normalizeDecayCurve(progress: number): number {
  if (progress <= 0) {
    return 1;
  }
  if (progress >= 1) {
    return 0;
  }
  const numerator = Math.exp(-CURVE_SHAPE * progress) - Math.exp(-CURVE_SHAPE);
  const denominator = 1 - Math.exp(-CURVE_SHAPE);
  return denominator !== 0 ? numerator / denominator : 1 - progress;
}

function blend(linear: number, curved: number, shape: number): number {
  return linear * (1 - shape) + curved * shape;
}

function evaluateEnvelope(normalizedTime: number, attackRatio: number, shape: number): number {
  const clampedTime = clamp01(normalizedTime);
  if (attackRatio <= EPSILON) {
    // No attack phase: instantaneous rise.
    const decayProgress = clamp01(clampedTime);
    const linear = 1 - decayProgress;
    const curved = normalizeDecayCurve(decayProgress);
    return blend(linear, curved, shape);
  }

  if (attackRatio >= 1 - EPSILON) {
    // No decay phase: stay in attack shape.
    const attackProgress = clamp01(clampedTime);
    const linear = attackProgress;
    const curved = normalizeAttackCurve(attackProgress);
    return blend(linear, curved, shape);
  }

  if (clampedTime <= attackRatio) {
    const attackProgress = clamp01(clampedTime / attackRatio);
    const linear = attackProgress;
    const curved = normalizeAttackCurve(attackProgress);
    return blend(linear, curved, shape);
  }

  const decaySpan = Math.max(1 - attackRatio, EPSILON);
  const decayProgress = clamp01((clampedTime - attackRatio) / decaySpan);
  const linear = 1 - decayProgress;
  const curved = normalizeDecayCurve(decayProgress);
  return blend(linear, curved, shape);
}

export function EnvelopeVisualizer({
  rise,
  fall,
  curve,
  value,
  progress
}: EnvelopeVisualizerProps): JSX.Element {
  const { polyline, cursor } = useMemo(() => {
    const total = Math.max(rise + fall, EPSILON);
    const attackRatio = Math.max(rise, EPSILON) / total;
    const shape = clamp01(curve);

    const points: Point[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t = SAMPLE_COUNT <= 1 ? 0 : i / (SAMPLE_COUNT - 1);
      const y = evaluateEnvelope(t, attackRatio, shape);
      points.push({ x: t, y });
    }

    const normalizedProgress = progress >= 0 ? clamp01(progress) : null;
    const cursorPoint =
      normalizedProgress !== null
        ? {
            x: normalizedProgress,
            y: evaluateEnvelope(normalizedProgress, attackRatio, shape)
          }
        : null;

    return {
      polyline: points,
      cursor: cursorPoint
    };
  }, [rise, fall, curve, progress]);

  const polylinePoints = polyline
    .map((point) => {
      const x = point.x * VIEWBOX_WIDTH;
      const y = (1 - point.y) * VIEWBOX_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const cursorX =
    cursor !== null ? cursor.x * VIEWBOX_WIDTH : null;
  const cursorY =
    cursor !== null ? (1 - cursor.y) * VIEWBOX_HEIGHT : null;
  const valueMarkerY =
    cursor !== null ? (1 - clamp01(value)) * VIEWBOX_HEIGHT : null;

  return (
    <div className="envelope-visualizer" aria-label="Envelope preview">
      <svg
        className="envelope-visualizer__svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <rect
          className="envelope-visualizer__background"
          x={0}
          y={0}
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
          rx={6}
        />
        <polyline
          className="envelope-visualizer__curve"
          fill="none"
          strokeWidth={2}
          points={polylinePoints}
        />
        {cursorX !== null && cursorY !== null ? (
          <>
            <line
              className="envelope-visualizer__cursor"
              x1={cursorX}
              y1={0}
              x2={cursorX}
              y2={VIEWBOX_HEIGHT}
            />
            <circle
              className="envelope-visualizer__marker"
              cx={cursorX}
              cy={cursorY}
              r={3}
            />
            {valueMarkerY !== null ? (
              <circle
                className="envelope-visualizer__value"
                cx={cursorX}
                cy={valueMarkerY}
                r={2}
              />
            ) : null}
          </>
        ) : null}
      </svg>
    </div>
  );
}
