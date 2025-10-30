const SLEW_MIN_TIME: f32 = 0.00001;

export class SlewLimiter {
  private value: f32 = 0.0;

  reset(): void {
    this.value = 0.0;
  }

  step(target: f32, riseSeconds: f32, fallSeconds: f32, morph: f32): f32 {
    const current: f32 = this.value;
    const dt: f32 = INV_SAMPLE_RATE_OVERSAMPLED;
    const clampedMorph: f32 = Mathf.max(0.0, Mathf.min(1.0, morph));
    const delta: f32 = target - current;

    if (Mathf.abs(delta) <= 1e-12) {
      this.value = target;
      return target;
    }

    const rise: f32 = Mathf.max(SLEW_MIN_TIME, riseSeconds);
    const fall: f32 = Mathf.max(SLEW_MIN_TIME, fallSeconds);

    let linearNext: f32 = target;
    let exponentialNext: f32 = target;

    if (delta > 0.0) {
      const maxLinearDelta: f32 = dt / rise;
      const constrainedDelta: f32 = delta < maxLinearDelta ? delta : maxLinearDelta;
      linearNext = current + constrainedDelta;

      const alpha: f32 = 1.0 - fastExp(-dt / rise);
      exponentialNext = current + delta * alpha;
    } else {
      const maxLinearDelta: f32 = dt / fall;
      const constrainedDelta: f32 = delta > -maxLinearDelta ? delta : -maxLinearDelta;
      linearNext = current + constrainedDelta;

      const alpha: f32 = 1.0 - fastExp(-dt / fall);
      exponentialNext = current + delta * alpha;
    }

    const blend: f32 = clampedMorph;
    const complement: f32 = 1.0 - blend;
    const output: f32 = linearNext * complement + exponentialNext * blend;

    this.value = output;
    return output;
  }
}
