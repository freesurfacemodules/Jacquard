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

  updateCoefficients(b0: f32, b1: f32, b2: f32, a1: f32, a2: f32): void {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
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
