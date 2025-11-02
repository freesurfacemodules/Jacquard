const MIN_FREQUENCY_HZ: f32 = 20.0;
const MAX_FREQUENCY_HZ: f32 = SAMPLE_RATE * 0.45;
const MIN_DECAY_SECONDS: f32 = 0.01;
const MAX_DECAY_SECONDS: f32 = 10.0;
const DECAY_RANGE: f32 = MAX_DECAY_SECONDS / MIN_DECAY_SECONDS;

@inline function clamp01(value: f32): f32 {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

@inline function hzFromPitch(pitch: f32): f32 {
  return FREQ_C4 * fastExp2(pitch);
}

@inline function pitchFromHz(freqHz: f32): f32 {
  const normalized = freqHz / FREQ_C4;
  return fastLog2(normalized);
}

@inline function secondsFromDecay(decayNormalized: f32): f32 {
  const t = clamp01(decayNormalized);
  return MIN_DECAY_SECONDS * fastPow(DECAY_RANGE, t);
}

@inline function radiusFromDecay(decayNormalized: f32): f32 {
  const seconds = secondsFromDecay(decayNormalized);
  const totalSamples = seconds * SAMPLE_RATE * (<f32>OVERSAMPLING);
  return Mathf.exp(-1.0 / totalSamples);
}

export class ComplexResonator {
  private filterReal: f32 = 1.0;
  private filterImag: f32 = 0.0;
  private stateReal: f32 = 0.0;
  private stateImag: f32 = 0.0;

  setTuning(pitch: f32, decayNormalized: f32): void {
    const frequency = hzFromPitch(pitch);
    const clampedFreq = Mathf.min(MAX_FREQUENCY_HZ, Mathf.max(MIN_FREQUENCY_HZ, frequency));
    const omega = f32(2.0) * Mathf.PI * clampedFreq / (SAMPLE_RATE * (<f32>OVERSAMPLING));

    const r = radiusFromDecay(decayNormalized);
    const cosOmega = Mathf.cos(omega);
    const sinOmega = Mathf.sin(omega);
    this.filterReal = r * cosOmega;
    this.filterImag = r * sinOmega;
  }

  process(realIn: f32, imagIn: f32): v128 {
    const realCoeff = this.filterReal;
    const imagCoeff = this.filterImag;

    const sr = this.stateReal;
    const si = this.stateImag;

    const nextReal = sr * realCoeff - si * imagCoeff + realIn;
    const nextImag = sr * imagCoeff + si * realCoeff + imagIn;

    this.stateReal = nextReal;
    this.stateImag = nextImag;

    const magnitude = Mathf.sqrt(nextReal * nextReal + nextImag * nextImag);
    const phase = Mathf.atan2(nextImag, nextReal);

    let outVec = f32x4.splat(0.0);
    outVec = f32x4.replace_lane(outVec, 0, nextReal);
    outVec = f32x4.replace_lane(outVec, 1, nextImag);
    outVec = f32x4.replace_lane(outVec, 2, magnitude);
    outVec = f32x4.replace_lane(outVec, 3, phase);
    return outVec;
  }
}
