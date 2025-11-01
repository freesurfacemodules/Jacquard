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

@inline function ladderClipVec(x: v128): v128 {
  const minVec = f32x4.splat(-6.0);
  const maxVec = f32x4.splat(6.0);
  let xc = f32x4.max(minVec, f32x4.min(maxVec, x));
  const x2 = f32x4.mul(xc, xc);
  const c27 = f32x4.splat(27.0);
  const numerator = f32x4.mul(xc, f32x4.add(c27, x2));
  const denominator = f32x4.add(c27, f32x4.mul(f32x4.splat(9.0), x2));
  return f32x4.div(numerator, denominator);
}

export class LadderFilter {
  private omega0: f32 = 0.0;       // 2π fc
  private R: f32 = 0.0;            // user resonance [0..1-ish]
  private drive: f32 = 1.0;        // input drive
  private state: v128 = f32x4.splat(0.0);
  private lastInput: f32 = 0.0;

  reset(): void {
    this.state = f32x4.splat(0.0);
    this.lastInput = 0.0;
  }

  setCutoff(cutoff: f32): void {
    this.omega0 = 6.283185307179586 * cutoff;
  }

  setResonance(value: f32): void {
    this.R = Mathf.max(0.0, value);
  }

  setDrive(d: f32): void {
    this.drive = Mathf.max(0.0, d);
  }

  process(sample: f32): void {
    const dt: f32 = INV_SAMPLE_RATE_OVERSAMPLED;
    const halfDtVec = f32x4.splat(dt * 0.5);
    const dtVec = f32x4.splat(dt);
    const scaleVec = f32x4.splat(dt / 6.0);
    const twoVec = f32x4.splat(2.0);
    const omega0: f32 = this.omega0;
    const omegaVec = f32x4.splat(omega0);

    const g: f32 = omega0 * dt;
    const comp: f32 = 1.0 + 0.5 * g + 0.25 * g * g;
    const k: f32 = 4.0 * this.R * comp;
    const x: f32 = this.drive * sample;

    let state = this.state;

    // k1
    const s3 = f32x4.extract_lane(state, 3);
    const u0 = ladderClip(x - k * s3);
    const yClip = ladderClipVec(state);
    let shifted = f32x4.shuffle(yClip, yClip, 0, 0, 1, 2);
    shifted = f32x4.replace_lane(shifted, 0, u0);
    const diff1 = f32x4.sub(shifted, yClip);
    const k1 = f32x4.mul(diff1, omegaVec);
    let mid = f32x4.add(state, f32x4.mul(k1, halfDtVec));

    // k2
    let midClip = ladderClipVec(mid);
    let uH = ladderClip(x - k * f32x4.extract_lane(mid, 3));
    shifted = f32x4.shuffle(midClip, midClip, 0, 0, 1, 2);
    shifted = f32x4.replace_lane(shifted, 0, uH);
    const diff2 = f32x4.sub(shifted, midClip);
    const k2 = f32x4.mul(diff2, omegaVec);
    mid = f32x4.add(state, f32x4.mul(k2, halfDtVec));

    // k3
    midClip = ladderClipVec(mid);
    uH = ladderClip(x - k * f32x4.extract_lane(mid, 3));
    shifted = f32x4.shuffle(midClip, midClip, 0, 0, 1, 2);
    shifted = f32x4.replace_lane(shifted, 0, uH);
    const diff3 = f32x4.sub(shifted, midClip);
    const k3 = f32x4.mul(diff3, omegaVec);
    mid = f32x4.add(state, f32x4.mul(k3, dtVec));

    // k4
    midClip = ladderClipVec(mid);
    const u1 = ladderClip(x - k * f32x4.extract_lane(mid, 3));
    shifted = f32x4.shuffle(midClip, midClip, 0, 0, 1, 2);
    shifted = f32x4.replace_lane(shifted, 0, u1);
    const diff4 = f32x4.sub(shifted, midClip);
    const k4 = f32x4.mul(diff4, omegaVec);

    const accum = f32x4.add(
      f32x4.add(k1, f32x4.mul(f32x4.add(k2, k3), twoVec)),
      k4
    );
    state = f32x4.add(state, f32x4.mul(accum, scaleVec));

    this.state = state;
    this.lastInput = sample;
  }

  lowpass(): f32 {
    return f32x4.extract_lane(this.state, 3);
  }

  highpass(): f32 {
    const omega0: f32 = this.omega0;
    const dt: f32 = INV_SAMPLE_RATE_OVERSAMPLED;
    const g: f32 = omega0 * dt;
    const comp: f32 = 1.0 + 0.5 * g + 0.25 * g * g;
    const k: f32 = 4.0 * this.R * comp;

    const x: f32 = this.drive * this.lastInput;
    const s = this.state;
    const s0 = f32x4.extract_lane(s, 0);
    const s1 = f32x4.extract_lane(s, 1);
    const s2 = f32x4.extract_lane(s, 2);
    const s3 = f32x4.extract_lane(s, 3);

    const u: f32 = ladderClip(x - k * s3);
    const y0: f32 = ladderClip(s0);
    const y1: f32 = ladderClip(s1);
    const y2: f32 = ladderClip(s2);
    const y3: f32 = ladderClip(s3);

    const hp: f32 = u - 4.0 * y0 + 6.0 * y1 - 4.0 * y2 + y3;
    return ladderClip(hp);
  }
}
