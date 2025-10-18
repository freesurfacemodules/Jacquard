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
      this.pendingParameters = [];
      this.envelopeMonitorCount = 0;
      this.envelopeMonitorValues = null;
      this.envelopeMonitorPointer = 0;
      this.envelopeUpdateCounter = 0;
      this.envelopeUpdateInterval = 4;
      this.scopeMonitorCount = 0;
      this.scopeMonitorCapacity = 0;
      this.scopeMonitorBufferPointer = 0;
      this.scopeMonitorMetaPointer = 0;
      this.scopeMonitorBuffers = null;
      this.scopeMonitorMeta = null;
      this.scopeUpdateCounter = 0;
      this.scopeUpdateInterval = 4;
      this.scopeConfig = options.processorOptions?.scopeMonitors ?? [];
      this.scopeLevelFactors = this.scopeConfig[0]?.levelFactors ?? [1];
      this.scopeLevelCount = this.scopeLevelFactors.length;
      if (this.scopeLevelCount <= 0) {
        this.scopeLevelCount = 1;
        this.scopeLevelFactors = [1];
      }
      this.scopeMetaStride = this.scopeLevelCount * 3 + 3;
      this.sampleRateValue = typeof sampleRate === "number" ? sampleRate : 48000;

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
          } else if (data.type === "parameter") {
            this.queueParameter(data.index, data.value);
          } else if (data.type === "parameterBatch") {
            if (Array.isArray(data.values)) {
              for (const entry of data.values) {
                if (!entry) continue;
                this.queueParameter(entry.index, entry.value);
              }
            }
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

      const scopeConfig = Array.isArray(processorOptions.scopeMonitors)
        ? processorOptions.scopeMonitors
        : this.scopeConfig;
      if (Array.isArray(scopeConfig) && scopeConfig.length > 0) {
        this.scopeConfig = scopeConfig;
        this.scopeLevelFactors = scopeConfig[0]?.levelFactors ?? this.scopeLevelFactors;
        this.scopeLevelCount = this.scopeLevelFactors.length || this.scopeLevelCount;
        if (this.scopeLevelCount <= 0) {
          this.scopeLevelCount = 1;
          this.scopeLevelFactors = [1];
        }
        this.scopeMetaStride = this.scopeLevelCount * 3 + 3;
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

      let envelopeMonitorCount = 0;
      let envelopeMonitorPointer = 0;
      let envelopeMonitorValues = null;
      if (
        typeof exports.getEnvelopeMonitorCount === "function" &&
        typeof exports.getEnvelopeMonitorPointer === "function"
      ) {
        envelopeMonitorCount = Number(exports.getEnvelopeMonitorCount()) | 0;
        if (envelopeMonitorCount > 0) {
          const pointer = exports.getEnvelopeMonitorPointer();
          if (typeof pointer === "number" && pointer >= 0) {
            envelopeMonitorPointer = pointer;
            envelopeMonitorValues = new Float32Array(
              memory.buffer,
              pointer,
              envelopeMonitorCount * 2
            );
          }
        }
      }

      let scopeMonitorCount = 0;
      let scopeMonitorCapacity = 0;
      let scopeMonitorBufferPointer = 0;
      let scopeMonitorMetaPointer = 0;
      let scopeMonitorBuffers = null;
      let scopeMonitorMeta = null;
      if (
        typeof exports.getScopeMonitorCount === "function" &&
        typeof exports.getScopeMonitorCapacity === "function" &&
        typeof exports.getScopeMonitorBufferPointer === "function" &&
        typeof exports.getScopeMonitorMetaPointer === "function"
      ) {
        scopeMonitorCount = Number(exports.getScopeMonitorCount()) | 0;
        scopeMonitorCapacity = Number(exports.getScopeMonitorCapacity()) | 0;
        const levelCount = this.scopeLevelCount;
        const metaStride = this.scopeMetaStride;
        if (scopeMonitorCount > 0 && scopeMonitorCapacity > 0) {
          const bufferPtr = exports.getScopeMonitorBufferPointer();
          const metaPtr = exports.getScopeMonitorMetaPointer();
          if (typeof bufferPtr === "number" && bufferPtr >= 0) {
            scopeMonitorBufferPointer = bufferPtr;
            scopeMonitorBuffers = new Float32Array(
              memory.buffer,
              bufferPtr,
              scopeMonitorCount * levelCount * scopeMonitorCapacity
            );
          }
          if (typeof metaPtr === "number" && metaPtr >= 0) {
            scopeMonitorMetaPointer = metaPtr;
            scopeMonitorMeta = new Float32Array(
              memory.buffer,
              metaPtr,
              scopeMonitorCount * metaStride
            );
          }
        }
      }

      this.state = {
        exports,
        memory,
        blockSize,
        ptrL,
        ptrR,
        left,
        right
      };
      this.envelopeMonitorCount = envelopeMonitorCount;
      this.envelopeMonitorPointer = envelopeMonitorPointer;
      this.envelopeMonitorValues = envelopeMonitorValues;
      this.envelopeUpdateCounter = 0;
      const updatesPerSecond = 60;
      const framesPerUpdate = Math.max(1, Math.floor(sampleRate / (blockSize * updatesPerSecond)));
      this.envelopeUpdateInterval = framesPerUpdate;
      this.scopeMonitorCount = scopeMonitorCount;
      this.scopeMonitorCapacity = scopeMonitorCapacity;
      this.scopeMonitorBufferPointer = scopeMonitorBufferPointer;
      this.scopeMonitorMetaPointer = scopeMonitorMetaPointer;
      this.scopeMonitorBuffers = scopeMonitorBuffers;
      this.scopeMonitorMeta = scopeMonitorMeta;
      this.scopeUpdateCounter = 0;
      this.scopeUpdateInterval = framesPerUpdate;
      this.ready = true;
      this.flushPendingParameters();
      this.port?.postMessage({ type: "ready" });
    }

    queueParameter(index, value) {
      if (this.ready && this.state) {
        this.applyParameter(index, value);
        return;
      }
      this.pendingParameters.push({ index, value });
    }

    flushPendingParameters() {
      if (!this.ready || !this.state) {
        return;
      }
      if (this.pendingParameters.length === 0) {
        return;
      }
      for (const entry of this.pendingParameters) {
        this.applyParameter(entry.index, entry.value);
      }
      this.pendingParameters.length = 0;
    }

    applyParameter(index, value) {
      const state = this.state;
      if (!state || typeof state.exports.setParameter !== "function") {
        return;
      }
      state.exports.setParameter(index | 0, Number(value));
    }

    process(_inputs, outputs) {
      const state = this.state;
      if (!this.ready || !state) {
        clearOutputs(outputs);
        return true;
      }

      this.refreshEnvelopeView();
      this.refreshScopeView();

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

      this.maybeEmitEnvelopeUpdate();
      this.maybeEmitScopeUpdate();

      return true;
    }

    refreshEnvelopeView() {
      if (!this.state || this.envelopeMonitorCount === 0) {
        return;
      }
      const pointerFn = this.state.exports.getEnvelopeMonitorPointer;
      if (typeof pointerFn !== "function") {
        return;
      }
      const pointer = pointerFn();
      if (typeof pointer === "number" && pointer >= 0) {
        if (
          !this.envelopeMonitorValues ||
          this.envelopeMonitorValues.buffer !== this.state.memory.buffer ||
          this.envelopeMonitorPointer !== pointer
        ) {
          this.envelopeMonitorPointer = pointer;
          this.envelopeMonitorValues = new Float32Array(
            this.state.memory.buffer,
            pointer,
            this.envelopeMonitorCount * 2
          );
        }
      }
    }

    maybeEmitEnvelopeUpdate() {
      if (
        this.envelopeMonitorCount === 0 ||
        !this.envelopeMonitorValues ||
        !this.port
      ) {
        return;
      }

      this.envelopeUpdateCounter++;
      if (this.envelopeUpdateCounter < this.envelopeUpdateInterval) {
        return;
      }
      this.envelopeUpdateCounter = 0;

      try {
        const snapshot = new Float32Array(this.envelopeMonitorValues);
        this.port.postMessage({ type: "envelopes", values: snapshot }, [snapshot.buffer]);
      } catch (error) {
        console.warn("[MaxWasm] Failed to post envelope monitors", error);
      }
    }

    refreshScopeView() {
      if (!this.state || this.scopeMonitorCount === 0) {
        return;
      }
      const bufferFn = this.state.exports.getScopeMonitorBufferPointer;
      const metaFn = this.state.exports.getScopeMonitorMetaPointer;
      if (typeof bufferFn === "function") {
        const pointer = bufferFn();
        if (typeof pointer === "number" && pointer >= 0) {
          if (
            !this.scopeMonitorBuffers ||
            this.scopeMonitorBuffers.buffer !== this.state.memory.buffer ||
            this.scopeMonitorBufferPointer !== pointer
          ) {
            this.scopeMonitorBufferPointer = pointer;
            this.scopeMonitorBuffers = new Float32Array(
              this.state.memory.buffer,
              pointer,
              this.scopeMonitorCount * this.scopeLevelCount * this.scopeMonitorCapacity
            );
          }
        }
      }
      if (typeof metaFn === "function") {
        const pointer = metaFn();
        if (typeof pointer === "number" && pointer >= 0) {
          if (
            !this.scopeMonitorMeta ||
            this.scopeMonitorMeta.buffer !== this.state.memory.buffer ||
            this.scopeMonitorMetaPointer !== pointer
          ) {
            this.scopeMonitorMetaPointer = pointer;
            this.scopeMonitorMeta = new Float32Array(
              this.state.memory.buffer,
              pointer,
              this.scopeMonitorCount * this.scopeMetaStride
            );
          }
        }
      }
    }

    maybeEmitScopeUpdate() {
      if (
        this.scopeMonitorCount === 0 ||
        !this.scopeMonitorBuffers ||
        !this.scopeMonitorMeta ||
        !this.port
      ) {
        return;
      }

      this.scopeUpdateCounter++;
      if (this.scopeUpdateCounter < this.scopeUpdateInterval) {
        return;
      }
      this.scopeUpdateCounter = 0;

      try {
        const transferables = [];
        const monitors = [];
        const capacity = this.scopeMonitorCapacity;
        const levelCount = this.scopeLevelCount;
        const metaStride = this.scopeMetaStride;
        const levelFactors = this.scopeLevelFactors;
        const sampleRateValue = this.sampleRateValue;

        for (let index = 0; index < this.scopeMonitorCount; index++) {
          const config = this.scopeConfig[index] ?? this.scopeConfig[0] ?? {};
          const factors = Array.isArray(config.levelFactors) && config.levelFactors.length > 0
            ? config.levelFactors
            : levelFactors;
          const metaBase = index * metaStride;
          const scale = this.scopeMonitorMeta[metaBase + levelCount * 3 + 0] ?? 1;
          const requestedTime = this.scopeMonitorMeta[metaBase + levelCount * 3 + 1] ?? 0.01;
          const modeValue = Math.round(this.scopeMonitorMeta[metaBase + levelCount * 3 + 2] ?? 0);

          const levelData = [];
          for (let level = 0; level < levelCount; level++) {
            const factor = factors[level] ?? (level > 0 ? factors[level - 1] * 2 : 1);
            const target = Math.max(1, Math.floor(this.scopeMonitorMeta[metaBase + level * 3 + 0] ?? capacity));
            const writeIndex = Math.max(0, Math.floor(this.scopeMonitorMeta[metaBase + level * 3 + 1] ?? 0));
            const captured = Math.max(0, Math.floor(this.scopeMonitorMeta[metaBase + level * 3 + 2] ?? 0));
            const coverage = modeValue === 0
              ? (target * factor) / sampleRateValue
              : (Math.min(captured, target) * factor) / sampleRateValue;
            const bufferBase = (index * levelCount + level) * capacity;
            levelData.push({ factor, target, writeIndex, captured, coverage, bufferBase });
          }

          let selectedLevel = 0;
          let selectedCoverage = levelData[0]?.coverage ?? 0;
          let bestMeets = selectedCoverage >= requestedTime - 1e-6;
          for (let level = 1; level < levelCount; level++) {
            const data = levelData[level];
            const meets = data.coverage >= requestedTime - 1e-6;
            if (bestMeets) {
              if (meets && data.coverage < selectedCoverage) {
                selectedLevel = level;
                selectedCoverage = data.coverage;
              }
            } else {
              if (meets || data.coverage > selectedCoverage) {
                selectedLevel = level;
                selectedCoverage = data.coverage;
                bestMeets = meets;
              }
            }
          }

          const chosen = levelData[selectedLevel];
          const factor = chosen.factor;
          const sampleInterval = factor / sampleRateValue;
          const mode = modeValue;

          let samples;
          if (mode === 0) {
            const valid = Math.min(chosen.target, chosen.captured > 0 ? chosen.captured : chosen.target);
            if (valid <= 0) {
              samples = new Float32Array(0);
            } else {
              samples = new Float32Array(valid);
              if (chosen.captured < chosen.target) {
                samples.set(
                  this.scopeMonitorBuffers.subarray(chosen.bufferBase, chosen.bufferBase + valid)
                );
              } else {
                const start = chosen.writeIndex % chosen.target;
                const first = Math.min(chosen.target - start, valid);
                samples.set(
                  this.scopeMonitorBuffers.subarray(
                    chosen.bufferBase + start,
                    chosen.bufferBase + start + first
                  ),
                  0
                );
                if (first < valid) {
                  samples.set(
                    this.scopeMonitorBuffers.subarray(
                      chosen.bufferBase,
                      chosen.bufferBase + (valid - first)
                    ),
                    first
                  );
                }
              }
            }
          } else {
            const valid = Math.min(chosen.captured, chosen.target, capacity);
            if (valid <= 0) {
              samples = new Float32Array(0);
            } else {
              samples = new Float32Array(
                this.scopeMonitorBuffers.subarray(chosen.bufferBase, chosen.bufferBase + valid)
              );
            }
          }

          const coverageSeconds = samples.length * sampleInterval;
          transferables.push(samples.buffer);
          monitors.push({
            index,
            samples,
            sampleInterval,
            scale,
            time: requestedTime,
            mode,
            factor,
            coverage: coverageSeconds
          });
        }

        this.port.postMessage(
          {
            type: "scopes",
            monitors
          },
          transferables
        );
      } catch (error) {
        console.warn("[MaxWasm] Failed to post scope monitors", error);
      }
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
