const CURVE_SHAPE: f32 = 5.0;
const MIN_TIME: f32 = 0.00001;
const NO_PROGRESS: f32 = -1.0;
const ZERO_F32: f32 = 0.0;
const ONE_F32: f32 = 1.0;

function normalizeAttackCurve(progress: f32): f32 {
  if (progress <= ZERO_F32) return ZERO_F32;
  if (progress >= ONE_F32) return ONE_F32;
  const numerator: f32 = <f32>(ONE_F32 - Mathf.exp(-CURVE_SHAPE * progress));
  const denominator: f32 = <f32>(ONE_F32 - Mathf.exp(-CURVE_SHAPE));
  return denominator != ZERO_F32 ? numerator / denominator : progress;
}

function normalizeDecayCurve(progress: f32): f32 {
  if (progress <= ZERO_F32) return ONE_F32;
  if (progress >= ONE_F32) return ZERO_F32;
  const numerator: f32 = <f32>(Mathf.exp(-CURVE_SHAPE * progress) - Mathf.exp(-CURVE_SHAPE));
  const denominator: f32 = <f32>(ONE_F32 - Mathf.exp(-CURVE_SHAPE));
  const fallback: f32 = <f32>(ONE_F32 - progress);
  return denominator != ZERO_F32 ? numerator / denominator : fallback;
}

@inline function blendCurves(linear: f32, curved: f32, shape: f32): f32 {
  const complement: f32 = ONE_F32 - shape;
  return linear * complement + curved * shape;
}

enum EnvelopeStage {
  Idle = 0,
  Attack = 1,
  Decay = 2
}

export class AdEnvelope {
  private stage: EnvelopeStage = EnvelopeStage.Idle;
  private elapsed: f32 = 0.0;
  private attackDuration: f32 = 0.01;
  private decayDuration: f32 = 0.1;
  private totalDuration: f32 = 0.11;
  private shape: f32 = 0.0;
  private value: f32 = 0.0;
  private progress: f32 = NO_PROGRESS;

  start(attack: f32, decay: f32, shape: f32): void {
    const attackDuration = Mathf.max(MIN_TIME, attack);
    const decayDuration = Mathf.max(MIN_TIME, decay);
    this.attackDuration = attackDuration;
    this.decayDuration = decayDuration;
    this.totalDuration = attackDuration + decayDuration;
    this.shape = Mathf.max(ZERO_F32, Mathf.min(ONE_F32, shape));
    this.elapsed = ZERO_F32;
    this.value = ZERO_F32;
    this.progress = ZERO_F32;
    this.stage = EnvelopeStage.Attack;
  }

  reset(): void {
    this.stage = EnvelopeStage.Idle;
    this.elapsed = ZERO_F32;
    this.value = ZERO_F32;
    this.progress = NO_PROGRESS;
  }

  step(): f32 {
    if (this.stage === EnvelopeStage.Idle) {
      this.value = ZERO_F32;
      this.progress = NO_PROGRESS;
      return this.value;
    }

    const dt = INV_SAMPLE_RATE_OVERSAMPLED;
    const shape = this.shape;

    if (this.stage === EnvelopeStage.Attack) {
      this.elapsed += dt;
      let attackProgress = this.attackDuration > MIN_TIME
        ? this.elapsed / this.attackDuration
        : ONE_F32;
      if (attackProgress >= ONE_F32) {
        attackProgress = ONE_F32;
      }

      const linear = attackProgress;
      const curved = normalizeAttackCurve(attackProgress);
      this.value = blendCurves(linear, curved, shape);

      const elapsedAttack = attackProgress >= ONE_F32
        ? this.attackDuration
        : Mathf.min(this.elapsed, this.attackDuration);
      this.progress = this.totalDuration > ZERO_F32
        ? elapsedAttack / this.totalDuration
        : ONE_F32;

      if (attackProgress >= ONE_F32) {
        this.stage = EnvelopeStage.Decay;
        this.elapsed = ZERO_F32;
      }

      return this.value;
    }

    if (this.stage === EnvelopeStage.Decay) {
      this.elapsed += dt;
      let decayProgress = this.decayDuration > MIN_TIME
        ? this.elapsed / this.decayDuration
        : ONE_F32;
      if (decayProgress >= ONE_F32) {
        decayProgress = ONE_F32;
      }

      const linear = ONE_F32 - decayProgress;
      const curved = normalizeDecayCurve(decayProgress);
      this.value = blendCurves(linear, curved, shape);

      const elapsedDecay = decayProgress >= ONE_F32
        ? this.decayDuration
        : Mathf.min(this.elapsed, this.decayDuration);
      this.progress = this.totalDuration > ZERO_F32
        ? (this.attackDuration + elapsedDecay) / this.totalDuration
        : ONE_F32;

      if (decayProgress >= ONE_F32) {
        this.reset();
      }

      return this.value;
    }

    return this.value;
  }

  getValue(): f32 {
    return this.value;
  }

  getProgress(): f32 {
    return this.progress;
  }

  isActive(): bool {
    return this.stage !== EnvelopeStage.Idle;
  }
}
