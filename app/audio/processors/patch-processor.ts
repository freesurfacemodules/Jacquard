// The processor currently produces silence until the compilation pipeline
// connects the generated WebAssembly module. It still tracks the parameters
// that will drive the runtime.

declare const globalThis: typeof globalThis & {
  AudioWorkletProcessor?: typeof AudioWorkletProcessor;
};

if (typeof globalThis.AudioWorkletProcessor === "undefined") {
  // Vitest and SSR environments do not expose AudioWorklet APIs. Exporting an
  // empty module avoids a ReferenceError during module evaluation.
  export {};
} else {
  class MaxWasmProcessor extends AudioWorkletProcessor {
    private readonly channels: number;

    constructor(options: AudioWorkletNodeOptions) {
      super(options);
      const outputChannelCount = options.outputChannelCount ?? [2];
      this.channels = outputChannelCount[0] ?? 2;
    }

    process(
      _inputs: Float32Array[][],
      outputs: Float32Array[][],
      _parameters: Record<string, Float32Array>
    ): boolean {
      const [left] = outputs;
      const frames = left?.[0]?.length ?? 0;

      for (const output of outputs) {
        for (const channel of output) {
          channel.fill(0);
        }
      }

      // TODO: Request audio from the Wasm renderer.
      return frames > 0;
    }
  }

  registerProcessor("maxwasm-patch", MaxWasmProcessor);
}
