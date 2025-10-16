export class SineOsc {
  private phase: f32 = 0.0;

  step(frequency: f32): f32 {
    const phaseDelta: f32 = frequency * INV_SAMPLE_RATE * TAU;
    this.phase += phaseDelta;
    if (this.phase >= TAU) {
      this.phase -= TAU;
    }
    return Mathf.sin(this.phase);
  }
}
