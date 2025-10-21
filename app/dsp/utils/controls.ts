import type { ControlStepContext, NodeControl } from "@dsp/types";

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 1;

export function resolveControlStep(
  control: NodeControl | undefined,
  context: ControlStepContext
): number {
  if (!control || control.type !== "slider") {
    return 0;
  }
  if (control.step == null) {
    return 0;
  }
  if (typeof control.step === "function") {
    const result = control.step(context);
    return Number.isFinite(result) ? result : 0;
  }
  return control.step;
}

export function resolveControlMin(
  control: NodeControl | undefined,
  context: ControlStepContext
): number {
  if (!control) {
    return DEFAULT_MIN;
  }
  if (control.type !== "slider") {
    if (control.options.length === 0) {
      return DEFAULT_MIN;
    }
    let minValue = control.options[0].value;
    for (let index = 1; index < control.options.length; index++) {
      const candidate = control.options[index].value;
      if (candidate < minValue) {
        minValue = candidate;
      }
    }
    return minValue;
  }
  const { min } = control;
  if (typeof min === "function") {
    const result = min(context);
    return Number.isFinite(result) ? result : DEFAULT_MIN;
  }
  return Number.isFinite(min) ? min : DEFAULT_MIN;
}

export function resolveControlMax(
  control: NodeControl | undefined,
  context: ControlStepContext
): number {
  if (!control) {
    return DEFAULT_MAX;
  }
  if (control.type !== "slider") {
    if (control.options.length === 0) {
      return DEFAULT_MAX;
    }
    let maxValue = control.options[0].value;
    for (let index = 1; index < control.options.length; index++) {
      const candidate = control.options[index].value;
      if (candidate > maxValue) {
        maxValue = candidate;
      }
    }
    return maxValue;
  }
  const { max } = control;
  if (typeof max === "function") {
    const result = max(context);
    return Number.isFinite(result) ? result : DEFAULT_MAX;
  }
  return Number.isFinite(max) ? max : DEFAULT_MAX;
}
