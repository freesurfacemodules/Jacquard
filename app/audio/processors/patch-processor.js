export {};

if (typeof globalThis.AudioWorkletProcessor === "undefined") {
  // Vitest / SSR: nothing to register.
} else {
  const PAGE_BYTES = 64 * 1024;

  class MaxWasmProcessor extends AudioWorkletProcessor {
    constructor(options = {}) {
      super(options);
      this.state = null;
      this.ready = false;

      if (this.port && typeof this.port.start === "function") {
        this.port.start();
      }

      if (this.port) {
        this.port.onmessage = (event) => {
          const data = event.data;
          if (!data || typeof data !== "object") {
            return;
          }
          if (data.type === "shutdown") {
            this.ready = false;
            this.state = null;
            this.port.postMessage({ type: "stopped" });
          }
        };
      }

      this.initializing = this.initialize(options.processorOptions).catch(
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.ready = false;
          this.state = null;
          this.port?.postMessage({ type: "error", message });
        }
      );
    }

    async initialize(processorOptions) {
      if (!processorOptions || !processorOptions.wasmBinary) {
        throw new Error("Missing WebAssembly binary.");
      }

      const binarySource = processorOptions.wasmBinary;
      const wasmBinary =
        binarySource instanceof Uint8Array
          ? binarySource
          : new Uint8Array(binarySource);

      const abort = () => {
        this.ready = false;
        this.state = null;
        this.port?.postMessage({
          type: "error",
          message: "Wasm module aborted execution."
        });
      };

      const importObject = {
        env: {
          abort,
          trace: () => {
            /* AssemblyScript trace stub */
          }
        }
      };

      const { instance } = await WebAssembly.instantiate(wasmBinary, importObject);
      const exports = instance.exports;

      if (typeof exports.process !== "function") {
        throw new Error("Wasm module is missing the process export.");
      }

      const memory = exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) {
        throw new Error("Wasm module is missing its memory export.");
      }

      const blockSize = readGlobal(exports.BLOCK_SIZE);
      if (!Number.isFinite(blockSize) || blockSize <= 0) {
        throw new Error("Wasm module reported an invalid BLOCK_SIZE.");
      }

      const blockBytes = blockSize * Float32Array.BYTES_PER_ELEMENT;
      const heapBase = exports.__heap_base ? Number(exports.__heap_base.value) : 0;

      let ptrL = alignPointer(heapBase, 16);
      let ptrR = alignPointer(ptrL + blockBytes, 16);
      const requiredBytes = ptrR + blockBytes;

      ensureMemoryCapacity(memory, requiredBytes);

      const buffer = memory.buffer;
      const left = new Float32Array(buffer, ptrL, blockSize);
      const right = new Float32Array(buffer, ptrR, blockSize);

      this.state = {
        exports,
        memory,
        blockSize,
        ptrL,
        ptrR,
        left,
        right
      };
      this.ready = true;
      this.port?.postMessage({ type: "ready" });
    }

    process(_inputs, outputs) {
      const state = this.state;
      if (!this.ready || !state) {
        clearOutputs(outputs);
        return true;
      }

      const destination = outputs[0];
      const frames = destination && destination[0] ? destination[0].length : 0;
      if (!destination || frames === 0) {
        return true;
      }

      let remaining = frames;
      let offset = 0;
      while (remaining > 0) {
        state.exports.process(state.ptrL, state.ptrR);
        const chunk = Math.min(state.blockSize, remaining);
        const leftSlice = state.left.subarray(0, chunk);
        const rightSlice = state.right.subarray(0, chunk);

        const leftChannel = destination[0];
        const rightChannel = destination[1] ?? destination[0];

        leftChannel.set(leftSlice, offset);
        rightChannel.set(rightSlice, offset);

        remaining -= chunk;
        offset += chunk;
      }

      return true;
    }
  }

  function alignPointer(pointer, alignment) {
    const mask = alignment - 1;
    return (pointer + mask) & ~mask;
  }

  function ensureMemoryCapacity(memory, bytesNeeded) {
    const currentBytes = memory.buffer.byteLength;
    if (bytesNeeded <= currentBytes) {
      return;
    }
    const additionalBytes = bytesNeeded - currentBytes;
    const pages = Math.ceil(additionalBytes / PAGE_BYTES);
    memory.grow(pages);
  }

  function clearOutputs(outputs) {
    for (const output of outputs) {
      for (const channel of output) {
        channel.fill(0);
      }
    }
  }

  function readGlobal(value) {
    if (typeof value === "number") {
      return value;
    }
    return Number(value.value);
  }

  registerProcessor("maxwasm-patch", MaxWasmProcessor);
}
