const COUNTER_MIN_MAX: i32 = 1;
const COUNTER_MAX_MAX: i32 = 128;

class CounterOutput {
  value: f32 = 0.0;
  maxSignal: f32 = 0.0;
}

export class CounterState {
  private count: i32 = 0;
  private maxValue: i32 = COUNTER_MIN_MAX;
  private readonly incrementTrigger: SchmittTrigger = new SchmittTrigger(2.5, 1.0);
  private readonly resetTrigger: SchmittTrigger = new SchmittTrigger(2.5, 1.0);
  private readonly output: CounterOutput = new CounterOutput();

  reset(): void {
    this.count = 0;
    this.incrementTrigger.reset();
    this.resetTrigger.reset();
  }

  setMaxValue(value: f32): void {
    let rounded: i32 = <i32>Mathf.round(value);
    if (rounded < COUNTER_MIN_MAX) {
      rounded = COUNTER_MIN_MAX;
    } else if (rounded > COUNTER_MAX_MAX) {
      rounded = COUNTER_MAX_MAX;
    }
    this.maxValue = rounded;
    if (this.count > this.maxValue) {
      this.count = this.maxValue;
    }
  }

  step(incrementSample: f32, resetSample: f32): CounterOutput {
    if (this.resetTrigger.process(resetSample)) {
      this.count = 0;
    }

    if (this.incrementTrigger.process(incrementSample)) {
      this.count += 1;
    }

    if (this.count > this.maxValue) {
      this.count = this.maxValue;
    }

    const maxValueF32: f32 = <f32>this.maxValue;
    const normalized: f32 = maxValueF32 > 0.0 ? <f32>this.count / maxValueF32 : 0.0;
    this.output.value = normalized * 10.0;
    this.output.maxSignal = this.count >= this.maxValue ? 10.0 : 0.0;
    return this.output;
  }
}
