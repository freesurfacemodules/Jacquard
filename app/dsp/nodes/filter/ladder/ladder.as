@inline function ladderClip(x: f32): f32 {
  let clamped = Mathf.max(-3.0, Mathf.min(3.0, x));
  const x2 = clamped * clamped;
  return clamped * (27.0 + x2) / (27.0 + 9.0 * x2);
}

@inline function ladderCrossfade(a: f32, b: f32, t: f32): f32 {
  return a + (b - a) * t;
}

export class LadderFilter {
  private omega0: f32 = 0.0;
  private resonance: f32 = 1.0;
  private s0: f32 = 0.0;
  private s1: f32 = 0.0;
  private s2: f32 = 0.0;
  private s3: f32 = 0.0;
  private currentInput: f32 = 0.0;

  reset(): void {
    this.s0 = 0.0;
    this.s1 = 0.0;
    this.s2 = 0.0;
    this.s3 = 0.0;
    this.currentInput = 0.0;
  }

  setCutoff(cutoff: f32): void {
    this.omega0 = 6.283185307179586 * cutoff;
  }

  setResonance(value: f32): void {
    this.resonance = value;
  }

  process(sample: f32): void {
    const dt = INV_SAMPLE_RATE_OVERSAMPLED;
    const halfDt = dt * 0.5;
    const scale = dt / 6.0;
    const omega0 = this.omega0;
    const resonance = this.resonance;
    const previousInput = this.currentInput;

    let s0 = this.s0;
    let s1 = this.s1;
    let s2 = this.s2;
    let s3 = this.s3;

    let input0 = ladderClip(ladderCrossfade(previousInput, sample, 0.0) - resonance * s3);
    let yc0 = ladderClip(s0);
    let yc1 = ladderClip(s1);
    let yc2 = ladderClip(s2);
    let yc3 = ladderClip(s3);

    let k1_0 = omega0 * (input0 - yc0);
    let k1_1 = omega0 * (yc0 - yc1);
    let k1_2 = omega0 * (yc1 - yc2);
    let k1_3 = omega0 * (yc2 - yc3);

    let y0 = s0 + k1_0 * halfDt;
    let y1 = s1 + k1_1 * halfDt;
    let y2 = s2 + k1_2 * halfDt;
    let y3 = s3 + k1_3 * halfDt;

    let inputHalf = ladderClip(ladderCrossfade(previousInput, sample, 0.5) - resonance * y3);
    yc0 = ladderClip(y0);
    yc1 = ladderClip(y1);
    yc2 = ladderClip(y2);
    yc3 = ladderClip(y3);

    let k2_0 = omega0 * (inputHalf - yc0);
    let k2_1 = omega0 * (yc0 - yc1);
    let k2_2 = omega0 * (yc1 - yc2);
    let k2_3 = omega0 * (yc2 - yc3);

    y0 = s0 + k2_0 * halfDt;
    y1 = s1 + k2_1 * halfDt;
    y2 = s2 + k2_2 * halfDt;
    y3 = s3 + k2_3 * halfDt;

    inputHalf = ladderClip(ladderCrossfade(previousInput, sample, 0.5) - resonance * y3);
    yc0 = ladderClip(y0);
    yc1 = ladderClip(y1);
    yc2 = ladderClip(y2);
    yc3 = ladderClip(y3);

    let k3_0 = omega0 * (inputHalf - yc0);
    let k3_1 = omega0 * (yc0 - yc1);
    let k3_2 = omega0 * (yc1 - yc2);
    let k3_3 = omega0 * (yc2 - yc3);

    y0 = s0 + k3_0 * dt;
    y1 = s1 + k3_1 * dt;
    y2 = s2 + k3_2 * dt;
    y3 = s3 + k3_3 * dt;

    let input1 = ladderClip(ladderCrossfade(previousInput, sample, 1.0) - resonance * y3);
    yc0 = ladderClip(y0);
    yc1 = ladderClip(y1);
    yc2 = ladderClip(y2);
    yc3 = ladderClip(y3);

    let k4_0 = omega0 * (input1 - yc0);
    let k4_1 = omega0 * (yc0 - yc1);
    let k4_2 = omega0 * (yc1 - yc2);
    let k4_3 = omega0 * (yc2 - yc3);

    this.s0 = s0 + scale * (k1_0 + 2.0 * (k2_0 + k3_0) + k4_0);
    this.s1 = s1 + scale * (k1_1 + 2.0 * (k2_1 + k3_1) + k4_1);
    this.s2 = s2 + scale * (k1_2 + 2.0 * (k2_2 + k3_2) + k4_2);
    this.s3 = s3 + scale * (k1_3 + 2.0 * (k2_3 + k3_3) + k4_3);

    this.currentInput = sample;
  }

  lowpass(): f32 {
    return this.s3;
  }

  highpass(): f32 {
    const hp = (this.currentInput - this.resonance * this.s3)
      - 4.0 * this.s0
      + 6.0 * this.s1
      - 4.0 * this.s2
      + this.s3;
    return ladderClip(hp);
  }
}
