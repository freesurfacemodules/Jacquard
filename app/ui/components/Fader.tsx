import { useCallback, useEffect, useRef } from "react";

interface FaderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue: number;
  onChange(value: number): void;
}

const MIN_DT = 1;
const VELOCITY_FLOOR = 0;
const VELOCITY_CEIL = 0.8;
const FINE_DIVISOR = 10000;
const COARSE_DIVISOR = 500;
const SHIFT_MULTIPLIER = 10;
const ALT_DIVISOR = 100;

export function Fader({ min, max, step = 0, value, defaultValue, onChange }: FaderProps): JSX.Element {
  const faderRef = useRef<HTMLDivElement | null>(null);
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
      let interpolated = fineGain + t * (coarseGain - fineGain);
      if (modifiers.shiftKey) {
        interpolated *= SHIFT_MULTIPLIER;
      }
      if (modifiers.altKey) {
        interpolated /= ALT_DIVISOR;
      }
      return interpolated;
    },
    []
  );

  const scheduleChange = useCallback(
    (nextValue: number, immediate = false) => {
      const clamped = clamp(nextValue);
      pendingValueRef.current = clamped;

      if (immediate) {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        onChange(clamped);
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
      const gain = computeGain(deltaY, deltaTime, range, {
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
    [clamp, computeGain, max, min, scheduleChange]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const element = faderRef.current;
    element?.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastY: event.clientY,
      lastTime: typeof event.timeStamp === "number" ? event.timeStamp : performance.now(),
      value
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = faderRef.current;
    if (!element || !element.hasPointerCapture(event.pointerId)) {
      return;
    }
    setValueFromPointer(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = faderRef.current;
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
    const gain = computeGain(-event.deltaY, deltaTime, range, {
      shiftKey: event.shiftKey,
      altKey: event.altKey
    });
    const nextValue = value + -event.deltaY * gain;
    scheduleChange(nextValue);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragStateRef.current = null;
    scheduleChange(defaultValue, true);
  };

  const percent =
    max === min ? 0 : (clamp(value) - min) / (max - min);
  const clampedPercent = Math.min(1, Math.max(0, percent));

  return (
    <div
      className="fader"
      ref={faderRef}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      tabIndex={0}
    >
      <div className="fader__track">
        <div className="fader__fill" style={{ height: `${clampedPercent * 100}%` }} />
        <div className="fader__thumb" style={{ bottom: `${clampedPercent * 100}%` }} />
      </div>
    </div>
  );
}
