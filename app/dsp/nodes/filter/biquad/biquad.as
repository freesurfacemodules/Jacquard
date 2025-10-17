class BiquadState {
  private b0: f32 = 0.0;
  private b1: f32 = 0.0;
  private b2: f32 = 0.0;
  private a1: f32 = 0.0;
  private a2: f32 = 0.0;
  private x1: f32 = 0.0;
  private x2: f32 = 0.0;
  private y1: f32 = 0.0;
  private y2: f32 = 0.0;

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0.0;
  }

  updateCoefficients(cutoff: f32, resonance: f32): void {
    let q = resonance;
    if (q < 0.1) q = 0.1;
    if (q > 20.0) q = 20.0;

    let fc = cutoff;
    if (fc < 20.0) fc = 20.0;
    let nyquist: f32 = SAMPLE_RATE * (<f32>OVERSAMPLING) * 0.5;
    if (fc > nyquist - 10.0) fc = nyquist - 10.0;
    if (fc < 0.0) fc = 0.0;

    const w0: f32 = TWO_PI * fc / (SAMPLE_RATE * (<f32>OVERSAMPLING));
    const cosW0: f32 = Mathf.cos(w0);
    const sinW0: f32 = Mathf.sin(w0);
    const alpha: f32 = sinW0 / (2.0 * q);

    const b0: f32 = (1.0 - cosW0) * 0.5;
    const b1: f32 = 1.0 - cosW0;
    const b2: f32 = (1.0 - cosW0) * 0.5;
    const a0: f32 = 1.0 + alpha;
    const a1: f32 = -2.0 * cosW0;
    const a2: f32 = 1.0 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(input: f32): f32 {
    const output =
      this.b0 * input +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;

    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

const TWO_PI: f32 = 6.283185307179586;
