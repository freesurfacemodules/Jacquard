const WAVEGUIDE_MIN_DELAY_UI: f32 = 0.125;
const WAVEGUIDE_MAX_DELAY_UI: f32 = 4096.0;
const WAVEGUIDE_MIN_INTERNAL_DELAY: f32 = 1.0 / (<f32>OVERSAMPLING);
const WAVEGUIDE_MAX_INTERNAL_DELAY: f32 = WAVEGUIDE_MAX_DELAY_UI * (<f32>OVERSAMPLING);
const WAVEGUIDE_BUFFER_LENGTH: i32 = <i32>Mathf.ceil(WAVEGUIDE_MAX_INTERNAL_DELAY) + 8;
const INV_SIX: f32 = 0.16666667;
const INV_TWO: f32 = 0.5;

@inline function wrapWaveguideIndex(index: i32): i32 {
  let result = index % WAVEGUIDE_BUFFER_LENGTH;
  if (result < 0) {
    result += WAVEGUIDE_BUFFER_LENGTH;
  }
  return result;
}

export class WaveguideDelay {
  private buffer: StaticArray<f32> = new StaticArray<f32>(WAVEGUIDE_BUFFER_LENGTH);
  private writeIndex: i32 = 0;
  private currentDelay: f32 = WAVEGUIDE_MIN_INTERNAL_DELAY;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (let i = 0; i < WAVEGUIDE_BUFFER_LENGTH; i++) {
      unchecked(this.buffer[i] = 0.0);
    }
    this.writeIndex = 0;
    this.currentDelay = WAVEGUIDE_MIN_INTERNAL_DELAY;
  }

  prepare(): f32 {
    let delaySamples: f32 = this.currentDelay;
    if (delaySamples < WAVEGUIDE_MIN_INTERNAL_DELAY) {
      delaySamples = WAVEGUIDE_MIN_INTERNAL_DELAY;
    }
    if (delaySamples > WAVEGUIDE_MAX_INTERNAL_DELAY) {
      delaySamples = WAVEGUIDE_MAX_INTERNAL_DELAY;
    }

    const bufferLengthF: f32 = <f32>WAVEGUIDE_BUFFER_LENGTH;
    let readPosition: f32 = <f32>this.writeIndex - delaySamples;
    while (readPosition < 0.0) {
      readPosition += bufferLengthF;
    }
    while (readPosition >= bufferLengthF) {
      readPosition -= bufferLengthF;
    }

    const floorIndexF: f32 = Mathf.floor(readPosition);
    const mu: f32 = (readPosition - floorIndexF) + 1.0;
    const baseIndex: i32 = <i32>floorIndexF - 1;

    const i0: i32 = wrapWaveguideIndex(baseIndex);
    const i1: i32 = wrapWaveguideIndex(baseIndex + 1);
    const i2: i32 = wrapWaveguideIndex(baseIndex + 2);
    const i3: i32 = wrapWaveguideIndex(baseIndex + 3);

    const s0: f32 = unchecked(this.buffer[i0]);
    const s1: f32 = unchecked(this.buffer[i1]);
    const s2: f32 = unchecked(this.buffer[i2]);
    const s3: f32 = unchecked(this.buffer[i3]);

    const mu1: f32 = mu;
    const mu2: f32 = mu - 1.0;
    const mu3: f32 = mu - 2.0;
    const mu4: f32 = mu - 3.0;

    const term3: f32 = s3 * mu1 * mu2 * mu3 * INV_SIX;
    const term2: f32 = s2 * mu1 * mu2 * mu4 * INV_TWO;
    const term1: f32 = s1 * mu1 * mu3 * mu4 * INV_TWO;
    const term0: f32 = s0 * mu2 * mu3 * mu4 * INV_SIX;

    return term3 - term2 + term1 - term0;
  }

  commit(sample: f32, delaySamples: f32): void {
    let clamped: f32 = delaySamples;
    if (clamped < WAVEGUIDE_MIN_INTERNAL_DELAY) {
      clamped = WAVEGUIDE_MIN_INTERNAL_DELAY;
    }
    if (clamped > WAVEGUIDE_MAX_INTERNAL_DELAY) {
      clamped = WAVEGUIDE_MAX_INTERNAL_DELAY;
    }
    this.currentDelay = clamped;
    unchecked(this.buffer[this.writeIndex] = sample);
    this.writeIndex++;
    if (this.writeIndex >= WAVEGUIDE_BUFFER_LENGTH) {
      this.writeIndex = 0;
    }
  }
}
