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
const SENSITIVITY = 0.005; // value change per pixel dragged

export function Knob({
  min,
  max,
  step = 0,
  value,
  defaultValue,
  onChange
}: KnobProps): JSX.Element {
  const knobRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(
    null
  );
  const pendingValueRef = useRef<number>(value);
  const frameRef = useRef<number | null>(null);

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
      const deltaY = state.startY - event.clientY;
      const range = max - min;
      const deltaValue = range * deltaY * SENSITIVITY;
      const nextValue = state.startValue + deltaValue;
      scheduleChange(nextValue, immediate);
    },
    [max, min, scheduleChange]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const element = knobRef.current;
    element?.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startValue: value
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
    const factor = range * 0.0025;
    const nextValue = value - event.deltaY * factor;
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
