@inline function ladderClip(x: f32): f32 {
  // Softer, wider knee; optional clamp widened to ±6 to avoid early gain sag.
  // Rational tanh-ish: x*(27+x^2)/(27+9x^2)
  // (You can also just return Mathf.tanh(x) if your target has fast math.)
  const xc = Mathf.max(-6.0, Mathf.min(6.0, x));
  const x2 = xc * xc;
  return xc * (27.0 + x2) / (27.0 + 9.0 * x2);
}

@inline function ladderCrossfade(a: f32, b: f32, t: f32): f32 {
  return a + (b - a) * t;
}

export class LadderFilter {
  private omega0: f32 = 0.0;       // 2π fc
  private k: f32 = 0.0;            // resonance feedback gain (calibrated)
  private s0: f32 = 0.0;
  private s1: f32 = 0.0;
  private s2: f32 = 0.0;
  private s3: f32 = 0.0;
  private lastInput: f32 = 0.0;

  // Tone controls
  private R: f32 = 0.0;            // user resonance [0..1-ish]
  private drive: f32 = 1.0;        // input drive

  reset(): void {
    this.s0 = this.s1 = this.s2 = this.s3 = 0.0;
    this.lastInput = 0.0;
  }

  setCutoff(cutoff: f32): void {
    // cutoff in Hz, omega0 = 2π fc
    this.omega0 = 6.283185307179586 * cutoff;
  }

  setResonance(value: f32): void {
    // let user set 0..1, map internally to Moog-like k ≈ 4R (with light comp)
    this.R = Mathf.max(0.0, value);
  }

  setDrive(d: f32): void {
    this.drive = Mathf.max(0.0, d);
  }

  process(sample: f32): void {
    const dt: f32 = INV_SAMPLE_RATE_OVERSAMPLED;
    const halfDt: f32 = dt * 0.5;
    const scale: f32 = dt / 6.0;

    const omega0: f32 = this.omega0;

    // Resonance calibration with mild cutoff compensation:
    // g = ω0·dt; C ≈ 1 + 0.5g + 0.25g^2 keeps loop gain steadier vs fc.
    const g: f32 = omega0 * dt;
    const comp: f32 = 1.0 + 0.5 * g + 0.25 * g * g;
    const k: f32 = 4.0 * this.R * comp;

    // Hold the *external* input constant within the RK4 step (ZOH).
    // Still let feedback vary via y3 mid-step.
    const x: f32 = this.drive * sample;

    // Fetch states
    let s0: f32 = this.s0;
    let s1: f32 = this.s1;
    let s2: f32 = this.s2;
    let s3: f32 = this.s3;

    // --- k1 ---
    // input to ladder: differential pair tanh at the *front*
    let u0: f32 = ladderClip(x - k * s3);
    let y0c: f32 = ladderClip(s0);
    let y1c: f32 = ladderClip(s1);
    let y2c: f32 = ladderClip(s2);
    let y3c: f32 = ladderClip(s3);

    let k1_0: f32 = omega0 * (u0  - y0c);
    let k1_1: f32 = omega0 * (y0c - y1c);
    let k1_2: f32 = omega0 * (y1c - y2c);
    let k1_3: f32 = omega0 * (y2c - y3c);

    let y0: f32 = s0 + k1_0 * halfDt;
    let y1: f32 = s1 + k1_1 * halfDt;
    let y2: f32 = s2 + k1_2 * halfDt;
    let y3: f32 = s3 + k1_3 * halfDt;

    // --- k2 ---
    let uH: f32 = ladderClip(x - k * y3);
    y0c = ladderClip(y0); y1c = ladderClip(y1); y2c = ladderClip(y2); y3c = ladderClip(y3);

    let k2_0: f32 = omega0 * (uH  - y0c);
    let k2_1: f32 = omega0 * (y0c - y1c);
    let k2_2: f32 = omega0 * (y1c - y2c);
    let k2_3: f32 = omega0 * (y2c - y3c);

    y0 = s0 + k2_0 * halfDt;
    y1 = s1 + k2_1 * halfDt;
    y2 = s2 + k2_2 * halfDt;
    y3 = s3 + k2_3 * halfDt;

    // --- k3 ---
    uH  = ladderClip(x - k * y3);
    y0c = ladderClip(y0); y1c = ladderClip(y1); y2c = ladderClip(y2); y3c = ladderClip(y3);

    let k3_0: f32 = omega0 * (uH  - y0c);
    let k3_1: f32 = omega0 * (y0c - y1c);
    let k3_2: f32 = omega0 * (y1c - y2c);
    let k3_3: f32 = omega0 * (y2c - y3c);

    y0 = s0 + k3_0 * dt;
    y1 = s1 + k3_1 * dt;
    y2 = s2 + k3_2 * dt;
    y3 = s3 + k3_3 * dt;

    // --- k4 ---
    let u1: f32 = ladderClip(x - k * y3);
    y0c = ladderClip(y0); y1c = ladderClip(y1); y2c = ladderClip(y2); y3c = ladderClip(y3);

    let k4_0: f32 = omega0 * (u1  - y0c);
    let k4_1: f32 = omega0 * (y0c - y1c);
    let k4_2: f32 = omega0 * (y1c - y2c);
    let k4_3: f32 = omega0 * (y2c - y3c);

    // Integrate
    s0 = s0 + scale * (k1_0 + 2.0 * (k2_0 + k3_0) + k4_0);
    s1 = s1 + scale * (k1_1 + 2.0 * (k2_1 + k3_1) + k4_1);
    s2 = s2 + scale * (k1_2 + 2.0 * (k2_2 + k3_2) + k4_2);
    s3 = s3 + scale * (k1_3 + 2.0 * (k2_3 + k3_3) + k4_3);

    // Commit
    this.s0 = s0; this.s1 = s1; this.s2 = s2; this.s3 = s3;
    this.lastInput = sample;
  }

  lowpass(): f32 {
    // last stage output; already cloftclipped in the dynamics
    return this.s3;
  }

  highpass(): f32 {
    // Use *current-time* input and nonlinear taps after the update.
    const omega0 : f32 = this.omega0;
    const dt : f32 = INV_SAMPLE_RATE_OVERSAMPLED;
    const g : f32 = omega0 * dt;
    const comp : f32 = 1.0 + 0.5 * g + 0.25 * g * g;
    const k : f32 = 4.0 * this.R * comp;

    const x : f32 = this.drive * this.lastInput; // if you want sample[n], pass it in here instead
    const u : f32 = ladderClip(x - k * this.s3);

    const y0 : f32 = ladderClip(this.s0);
    const y1 : f32 = ladderClip(this.s1);
    const y2 : f32 = ladderClip(this.s2);
    const y3 : f32 = ladderClip(this.s3);

    const hp : f32 = u - 4.0 * y0 + 6.0 * y1 - 4.0 * y2 + y3;
    return ladderClip(hp);
  }
}
