const MAX_DELAY_SAMPLES: i32 = 4096 * OVERSAMPLING;
const DELAY_BUFFER_LENGTH: i32 = MAX_DELAY_SAMPLES + 1;
const MIN_DELAY_SAMPLES: f32 = 1.0 / (<f32>OVERSAMPLING);

class DdlDelay {
  private buffer: StaticArray<f32> = new StaticArray<f32>(DELAY_BUFFER_LENGTH);
  private writeIndex: i32 = 0;
  private currentSamples: i32 = 1;

  constructor() {
    this.reset();
  }

  reset(): void {
    for (let i = 0; i < DELAY_BUFFER_LENGTH; i++) {
      unchecked(this.buffer[i] = 0.0);
    }
    this.writeIndex = 0;
    this.currentSamples = 1;
  }

  prepare(): f32 {
    let readIndex = this.writeIndex - this.currentSamples;
    if (readIndex < 0) {
      readIndex += DELAY_BUFFER_LENGTH;
    }
    return unchecked(this.buffer[readIndex]);
  }

  commit(input: f32, samples: i32): void {
    this.currentSamples = samples;
    unchecked(this.buffer[this.writeIndex] = input);
    this.writeIndex++;
    if (this.writeIndex >= DELAY_BUFFER_LENGTH) {
      this.writeIndex = 0;
    }
  }
}
