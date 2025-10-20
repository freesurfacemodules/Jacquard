import type { ControlStepContext, NodeControl } from "@dsp/types";

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 1;

export function resolveControlStep(
  control: NodeControl | undefined,
  context: ControlStepContext
): number {
  if (!control || control.step == null) {
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
  const { max } = control;
  if (typeof max === "function") {
    const result = max(context);
    return Number.isFinite(result) ? result : DEFAULT_MAX;
  }
  return Number.isFinite(max) ? max : DEFAULT_MAX;
}
