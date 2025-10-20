import { useCallback, useEffect, useRef } from "react";

interface KnobProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue: number;
  onChange(value: number): void;
}

const MIN_ANGLE = -135;
const MAX_ANGLE = 135;
const MIN_DT = 1;
const VELOCITY_FLOOR = 0;
const VELOCITY_CEIL = 0.8; // px per ms
const FINE_DIVISOR = 10000;
const COARSE_DIVISOR = 500;
const SHIFT_MULTIPLIER = 10;
const ALT_DIVISOR = 100;

export function Knob({ min, max, step = 0, value, defaultValue, onChange }: KnobProps): JSX.Element {
  const knobRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    value: number;
    lastY: number;
    lastTime: number;
  } | null>(null);
  const pendingValueRef = useRef<number>(value);
  const frameRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef<number | null>(null);

  const clamp = useCallback(
    (nextValue: number) => {
      let bounded = Math.min(max, Math.max(min, nextValue));
      if (step > 0) {
        const snapped = Math.round(bounded / step) * step;
        bounded = Math.min(max, Math.max(min, snapped));
      }
      return bounded;
    },
    [min, max, step]
  );

  const computeGain = useCallback(
    (
      deltaY: number,
      deltaTime: number,
      range: number,
      modifiers: { shiftKey: boolean; altKey: boolean }
    ): number => {
      const absRange = Math.max(range, 1e-6);
      const fineGain = absRange / FINE_DIVISOR;
      const coarseGain = absRange / COARSE_DIVISOR;
      const speed = Math.min(
        VELOCITY_CEIL,
        Math.max(
          VELOCITY_FLOOR,
          Math.abs(deltaY) / Math.max(deltaTime, MIN_DT)
        )
      );
      const t = (speed - VELOCITY_FLOOR) / (VELOCITY_CEIL - VELOCITY_FLOOR);
      const interpolated = fineGain + t * (coarseGain - fineGain);
      let modified = interpolated;
      if (modifiers.shiftKey) {
        modified *= SHIFT_MULTIPLIER;
      }
      if (modifiers.altKey) {
        modified /= ALT_DIVISOR;
      }
      return modified;
    },
    []
  );

  const scheduleChange = useCallback(
    (nextValue: number, immediate = false) => {
      const clampedValue = clamp(nextValue);
      pendingValueRef.current = clampedValue;

      if (immediate) {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        onChange(clampedValue);
        return;
      }

      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          onChange(pendingValueRef.current);
        });
      }
    },
    [clamp, onChange]
  );

  useEffect(() => {
    pendingValueRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  const setValueFromPointer = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLDivElement>, immediate = false) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }
      const currentY = event.clientY;
      const deltaY = state.lastY - currentY;
      const range = max - min;
      const now = typeof event.timeStamp === "number" ? event.timeStamp : performance.now();
      const deltaTime = now - state.lastTime;
      const windowedDeltaY = deltaY;
      const gain = computeGain(windowedDeltaY, deltaTime, range, {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      });
      const deltaValue = gain * deltaY;
      const nextValue = clamp(state.value + deltaValue);
      state.value = nextValue;
      state.lastY = currentY;
      state.lastTime = now;
      scheduleChange(nextValue, immediate);
    },
    [max, min, clamp, scheduleChange, computeGain]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const element = knobRef.current;
    element?.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastY: event.clientY,
      lastTime: typeof event.timeStamp === "number" ? event.timeStamp : performance.now(),
      value
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = knobRef.current;
    if (!element || !element.hasPointerCapture(event.pointerId)) {
      return;
    }
    setValueFromPointer(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = knobRef.current;
    if (!element || !element.hasPointerCapture(event.pointerId)) {
      return;
    }
    setValueFromPointer(event, true);
    element.releasePointerCapture(event.pointerId);
    dragStateRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const range = max - min;
    const now = typeof event.timeStamp === "number" ? event.timeStamp : performance.now();
    const lastTime = lastWheelTimeRef.current ?? now;
    const deltaTime = now - lastTime;
    lastWheelTimeRef.current = now;
    const gain = computeGain(event.deltaY, deltaTime, range, {
      shiftKey: event.shiftKey,
      altKey: event.altKey
    });
    const nextValue = value - event.deltaY * gain;
    scheduleChange(nextValue);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragStateRef.current = null;
    scheduleChange(defaultValue, true);
  };

  const angle = MIN_ANGLE + ((value - min) / (max - min)) * (MAX_ANGLE - MIN_ANGLE);

  return (
    <div
      className="knob"
      ref={knobRef}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <div className="knob__indicator" style={{ transform: `rotate(${angle}deg)` }} />
    </div>
  );
}
