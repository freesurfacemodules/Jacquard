export class SchmittTrigger {
  private thresholdHigh: f32;
  private thresholdLow: f32;
  private gate: bool = false;

  constructor(thresholdHigh: f32 = 0.2, thresholdLow: f32 = 0.1) {
    this.thresholdHigh = thresholdHigh;
    this.thresholdLow = thresholdLow;
  }

  setThresholds(thresholdHigh: f32, thresholdLow: f32): void {
    this.thresholdHigh = thresholdHigh;
    this.thresholdLow = thresholdLow;
  }

  reset(): void {
    this.gate = false;
  }

  /**
   * Processes a single sample and returns true when a rising edge is detected.
   */
  process(sample: f32): bool {
    if (!this.gate && sample >= this.thresholdHigh) {
      this.gate = true;
      return true;
    }
    if (this.gate && sample <= this.thresholdLow) {
      this.gate = false;
    }
    return false;
  }

  /**
   * Returns whether the trigger is currently in the high state.
   */
  isHigh(): bool {
    return this.gate;
  }
}
