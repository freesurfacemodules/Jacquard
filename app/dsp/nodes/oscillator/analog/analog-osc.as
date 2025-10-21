const ANALOG_OSC_KMAX: i32 = 128;
const ANALOG_OSC_TARGET_PEAK: f32 = 0.9;
const ANALOG_OSC_BW_TAU: f32 = 0.001;
const ANALOG_OSC_LUT_SIZE: i32 = 1024;
const ANALOG_OSC_HALF_PI: f32 = 0.5 * Mathf.PI;
const ANALOG_OSC_TWO_PI: f32 = TAU;
const ANALOG_OSC_LUT_INV_QSPAN: f32 = <f32>ANALOG_OSC_LUT_SIZE / ANALOG_OSC_HALF_PI;
const ANALOG_OSC_DEFAULT_TILT: f32 = 1.0;

class SinCosResult {
  sin: f32 = 0.0;
  cos: f32 = 0.0;
}

class SinCosLut {
  private samples: StaticArray<f32> = new StaticArray<f32>(ANALOG_OSC_LUT_SIZE + 1);

  init(): void {
    for (let index = 0; index <= ANALOG_OSC_LUT_SIZE; index++) {
      const t: f32 = <f32>index / <f32>ANALOG_OSC_LUT_SIZE;
      const x: f32 = ANALOG_OSC_HALF_PI * t;
      unchecked((this.samples[index] = Mathf.sin(x)));
    }
    unchecked((this.samples[ANALOG_OSC_LUT_SIZE] = 1.0));
  }

  @inline
  private interpolate(index: i32, t: f32): f32 {
    let idx = index;
    if (idx < 0) {
      idx = 0;
    } else if (idx > ANALOG_OSC_LUT_SIZE - 1) {
      idx = ANALOG_OSC_LUT_SIZE - 1;
    }

    let tt = t;
    if (tt < 0.0) {
      tt = 0.0;
    } else if (tt > 1.0) {
      tt = 1.0;
    }

    const y0: f32 = unchecked(this.samples[idx]);
    const y1: f32 = unchecked(this.samples[idx + 1]);
    const prevSample: f32 = idx > 0 ? unchecked(this.samples[idx - 1]) : y0;
    let next2: f32;
    if (idx < ANALOG_OSC_LUT_SIZE - 1) {
      next2 = unchecked(this.samples[idx + 2]);
    } else if (idx > 0) {
      next2 = unchecked(this.samples[idx - 1]);
    } else {
      next2 = y1;
    }

    const m0: f32 = (y1 - prevSample) * 0.5;
    const m1: f32 = (next2 - y0) * 0.5;

    const tt2: f32 = tt * tt;
    const tt3: f32 = tt2 * tt;

    const h00: f32 = 2.0 * tt3 - 3.0 * tt2 + 1.0;
    const h10: f32 = tt3 - 2.0 * tt2 + tt;
    const h01: f32 = -2.0 * tt3 + 3.0 * tt2;
    const h11: f32 = tt3 - tt2;

    return h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1;
  }

  sincos(angle: f32, out: SinCosResult): void {
    let x: f32 = angle % ANALOG_OSC_TWO_PI;
    if (x < 0.0) {
      x += ANALOG_OSC_TWO_PI;
    }

    let quadrant: i32 = <i32>Mathf.floor(x / ANALOG_OSC_HALF_PI);
    quadrant = quadrant & 3;

    const base: f32 = x - <f32>quadrant * ANALOG_OSC_HALF_PI;
    const u: f32 = base * ANALOG_OSC_LUT_INV_QSPAN;
    let index: i32 = <i32>u;
    if (index > ANALOG_OSC_LUT_SIZE - 1) {
      index = ANALOG_OSC_LUT_SIZE - 1;
    }
    const t: f32 = u - <f32>index;
    const sinBase: f32 = this.interpolate(index, t);

    const mirrored: f32 = ANALOG_OSC_HALF_PI - base;
    const uCos: f32 = mirrored * ANALOG_OSC_LUT_INV_QSPAN;
    let indexCos: i32 = <i32>uCos;
    if (indexCos > ANALOG_OSC_LUT_SIZE - 1) {
      indexCos = ANALOG_OSC_LUT_SIZE - 1;
    }
    const tCos: f32 = uCos - <f32>indexCos;
    const cosBase: f32 = this.interpolate(indexCos, tCos);

    switch (quadrant & 3) {
      case 0: {
        out.sin = sinBase;
        out.cos = cosBase;
        break;
      }
      case 1: {
        out.sin = cosBase;
        out.cos = -sinBase;
        break;
      }
      case 2: {
        out.sin = -sinBase;
        out.cos = -cosBase;
        break;
      }
      default: {
        out.sin = -cosBase;
        out.cos = sinBase;
        break;
      }
    }
  }
}

let analogSinCosLutInitialized: bool = false;
const analogSinCosLut = new SinCosLut();

function ensureAnalogSinCosLut(): void {
  if (!analogSinCosLutInitialized) {
    analogSinCosLut.init();
    analogSinCosLutInitialized = true;
  }
}

class AnalogOsc {
  private phase: f64 = 0.0;
  private bandwidth: f32 = 0.0;
  private prevFm: f32 = 0.0;
  private currentWaveform: i32 = -1;
  private currentTilt: f32 = -1.0;
  private coeffA: StaticArray<f32> = new StaticArray<f32>(ANALOG_OSC_KMAX + 1);
  private coeffB: StaticArray<f32> = new StaticArray<f32>(ANALOG_OSC_KMAX + 1);
  private scratch: SinCosResult = new SinCosResult();

  constructor() {
    ensureAnalogSinCosLut();
    this.rebuildCoefficients(0, ANALOG_OSC_DEFAULT_TILT);
  }

  @inline
  private sanitizeTilt(input: f32): f32 {
    if (input < 0.0) {
      return 0.0;
    }
    if (input > 4.0) {
      return 4.0;
    }
    return input;
  }

  private rebuildCoefficients(waveform: i32, tilt: f32): void {
    const rho: f32 = this.sanitizeTilt(tilt);

    for (let k = 0; k <= ANALOG_OSC_KMAX; k++) {
      unchecked((this.coeffA[k] = 0.0));
      unchecked((this.coeffB[k] = 0.0));
    }

    switch (waveform) {
      case 1: {
        for (let k = 1; k <= ANALOG_OSC_KMAX; k++) {
          if ((k & 1) === 1) {
            const harmonic: f32 = <f32>k;
            const tiltGain: f32 = Mathf.pow(harmonic, -rho);
            unchecked((this.coeffB[k] = (4.0 / Mathf.PI) * (1.0 / harmonic) * tiltGain));
          }
        }
        break;
      }
      case 2: {
        for (let k = 1; k <= ANALOG_OSC_KMAX; k++) {
          if ((k & 1) === 1) {
            const harmonic: f32 = <f32>k;
            const tiltGain: f32 = Mathf.pow(harmonic, -rho);
            const idx: i32 = ((k + 1) >> 1) & 1;
            const alt: f32 = idx === 1 ? -1.0 : 1.0;
            unchecked(
              (this.coeffA[k] =
                (8.0 / (Mathf.PI * Mathf.PI)) *
                alt /
                (harmonic * harmonic) *
                tiltGain)
            );
          }
        }
        break;
      }
      default: {
        for (let k = 1; k <= ANALOG_OSC_KMAX; k++) {
          const harmonic: f32 = <f32>k;
          const tiltGain: f32 = Mathf.pow(harmonic, -rho);
          unchecked((this.coeffB[k] = (2.0 / Mathf.PI) * (1.0 / harmonic) * tiltGain));
        }
        break;
      }
    }

    let energy: f32 = 0.0;
    for (let k = 1; k <= ANALOG_OSC_KMAX; k++) {
      const a: f32 = unchecked(this.coeffA[k]);
      const b: f32 = unchecked(this.coeffB[k]);
      energy += a * a + b * b;
    }

    if (energy > 1e-12) {
      const estPeak: f32 = 1.5 * Mathf.sqrt(energy);
      if (estPeak > 1e-6) {
        const gain: f32 = ANALOG_OSC_TARGET_PEAK / estPeak;
        for (let k = 1; k <= ANALOG_OSC_KMAX; k++) {
          unchecked((this.coeffA[k] *= gain));
          unchecked((this.coeffB[k] *= gain));
        }
      }
    }

    this.currentWaveform = waveform;
    this.currentTilt = rho;
  }

  step(
    carrierDelta: f32,
    fmDelta: f32,
    waveform: i32,
    tilt: f32,
    guardHz: f32,
    betaParam: f32
  ): f32 {
    ensureAnalogSinCosLut();

    let wf: i32 = waveform;
    if (wf < 0) {
      wf = 0;
    } else if (wf > 2) {
      wf = 2;
    }
    const rho: f32 = this.sanitizeTilt(tilt);
    if (wf !== this.currentWaveform || Mathf.abs(rho - this.currentTilt) > 0.0005) {
      this.rebuildCoefficients(wf, rho);
    }

    const totalDelta: f32 = carrierDelta + fmDelta;
    this.phase += <f64>totalDelta;

    const twoPi64: f64 = <f64>ANALOG_OSC_TWO_PI;
    const pi64: f64 = twoPi64 * 0.5;
    if (this.phase <= -pi64) {
      this.phase += twoPi64;
    } else if (this.phase > pi64) {
      this.phase -= twoPi64;
    }

    const sampleRate: f32 = SAMPLE_RATE * <f32>OVERSAMPLING;
    const invTau: f32 = sampleRate / ANALOG_OSC_TWO_PI;
    const fInst: f32 = Mathf.abs(totalDelta) * invTau;

    const fmDiff: f32 = Mathf.abs(fmDelta - this.prevFm);
    this.prevFm = fmDelta;
    const bandwidthHz: f32 = fmDiff * invTau;

    const tauSteps: f32 = Mathf.max(1.0, ANALOG_OSC_BW_TAU * sampleRate);
    const pole: f32 = Mathf.exp(-1.0 / tauSteps);
    this.bandwidth = pole * this.bandwidth + (1.0 - pole) * bandwidthHz;

    const beta: f32 = betaParam < 0.5 ? 0.5 : betaParam;
    let guard: f32 = guardHz;
    if (guard < 0.0) {
      guard = 0.0;
    }

    let nyquist: f32 = 0.5 * sampleRate - guard;
    if (nyquist < 10.0) {
      nyquist = 10.0;
    }

    const spread: f32 = fInst + beta * this.bandwidth;
    let harmonicLimit: i32 = ANALOG_OSC_KMAX;
    if (spread > 0.0) {
      const ratio: f32 = nyquist / Mathf.max(1.0, spread);
      const candidate: i32 = <i32>Mathf.floor(ratio);
      if (candidate < harmonicLimit) {
        harmonicLimit = candidate;
      }
    }

    if (harmonicLimit < 1) {
      harmonicLimit = 1;
    } else if (harmonicLimit > ANALOG_OSC_KMAX) {
      harmonicLimit = ANALOG_OSC_KMAX;
    }

    analogSinCosLut.sincos(<f32>this.phase, this.scratch);
    const sin1: f32 = this.scratch.sin;
    const cos1: f32 = this.scratch.cos;

    let sk: f32 = sin1;
    let ck: f32 = cos1;
    let out: f32 = 0.0;

    for (let k = 1; k <= harmonicLimit; k++) {
      const a: f32 = unchecked(this.coeffA[k]);
      const b: f32 = unchecked(this.coeffB[k]);
      out += a * ck + b * sk;

      const nextC: f32 = ck * cos1 - sk * sin1;
      const nextS: f32 = sk * cos1 + ck * sin1;
      ck = nextC;
      sk = nextS;
    }

    return out;
  }

  resetPhase(angle: f32 = 0.0): void {
    this.phase = <f64>angle;
    this.bandwidth = 0.0;
    this.prevFm = 0.0;
  }
}
