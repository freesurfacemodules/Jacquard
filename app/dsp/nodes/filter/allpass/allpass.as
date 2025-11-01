const MIN_CUTOFF: f32 = f32(10.0);
const MAX_CUTOFF_RATIO: f32 = f32(0.49);

export class AllpassFilter {
  private a1: f32 = f32(1.0);
  private a2: f32 = f32(0.0);
  private a3: f32 = f32(0.0);
  private m0: f32 = f32(1.0);
  private m1: f32 = f32(-2.0);
  private m2: f32 = f32(-1.0);
  private ic1eq: f32 = f32(0.0);
  private ic2eq: f32 = f32(0.0);

  setCutoff(cutoffHz: f32): void {
    let cutoff = cutoffHz;
    if (cutoff < MIN_CUTOFF) cutoff = MIN_CUTOFF;
    const maxCutoff: f32 = SAMPLE_RATE * MAX_CUTOFF_RATIO;
    if (cutoff > maxCutoff) cutoff = maxCutoff;

    const normalized = Mathf.min(
      MAX_CUTOFF_RATIO,
      Mathf.max(f32(0.0001), cutoff / (SAMPLE_RATE * (<f32>OVERSAMPLING)))
    );

    const g = Mathf.tan(Mathf.PI * normalized);
    const k: f32 = f32(2.0); // 1/0.5
    const denom: f32 = f32(1.0) + g * (g + k);
    const a1: f32 = f32(1.0) / denom;
    const a2: f32 = g * a1;
    const a3: f32 = g * a2;

    this.a1 = a1;
    this.a2 = a2;
    this.a3 = a3;
    this.m0 = f32(1.0);
    this.m1 = -k;
    this.m2 = f32(-1.0);
  }

  process(sample: f32): f32 {
    let ic1 = this.ic1eq;
    let ic2 = this.ic2eq;

    const v3 = sample - ic2;
    const v1 = this.a1 * ic1 + this.a2 * v3;
    const v2 = ic2 + this.a2 * ic1 + this.a3 * v3;
    ic1 = f32(2.0) * v1 - ic1;
    ic2 = f32(2.0) * v2 - ic2;

    this.ic1eq = ic1;
    this.ic2eq = ic2;

    const out: f32 = v2 - (this.m0 * sample + this.m1 * v1 + this.m2 * v2);
    return out;
  }
}
