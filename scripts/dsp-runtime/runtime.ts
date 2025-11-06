import fs from "node:fs/promises";
import { resolvePath } from "./utils";
import type { RuntimeMetadata } from "./utils";
import type { MathMode } from "@codegen/assemblyscript";

const PAGE_BYTES = 64 * 1024;

export interface PatchRuntime {
  moduleName: string;
  sampleRate: number;
  blockSize: number;
  mathMode: MathMode;
  optimizer: "asc" | "asc+binaryen";
  left: Float32Array;
  right: Float32Array;
  parameterCount: number;
  processBlock(): void;
  setParameter(index: number, value: number): void;
}

interface PatchExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  process: (ptrLeft: number, ptrRight: number) => void;
  setParameter?: (index: number, value: number) => void;
  BLOCK_SIZE?: number | WebAssembly.Global;
  SAMPLE_RATE?: number | WebAssembly.Global;
  __heap_base?: number | WebAssembly.Global;
}

export async function loadWasmBinary(path: string): Promise<Uint8Array> {
  const absolute = resolvePath(path);
  const contents = await fs.readFile(absolute);
  return contents instanceof Uint8Array ? contents : new Uint8Array(contents);
}

export async function loadMetadata(path: string): Promise<RuntimeMetadata> {
  const absolute = resolvePath(path);
  const contents = await fs.readFile(absolute, "utf8");
  const data = JSON.parse(contents) as Partial<RuntimeMetadata>;
  return {
    mathMode: (data.mathMode as MathMode) ?? "fast",
    optimizer: (data.optimizer as "asc" | "asc+binaryen") ?? "asc",
    moduleName: data.moduleName ?? "jacquard_patch",
    sampleRate: data.sampleRate ?? 48000,
    blockSize: data.blockSize ?? 128,
    oversampling: data.oversampling ?? 1,
    parameterCount: data.parameterCount ?? 0,
    controls: data.controls ?? [],
    envelopeMonitors: data.envelopeMonitors ?? [],
    scopeMonitors: data.scopeMonitors ?? []
  };
}

export async function instantiatePatchRuntime(
  wasmBinary: Uint8Array,
  metadata: RuntimeMetadata
): Promise<PatchRuntime> {
  const importObject = {
    env: {
      abort: () => {
        throw new Error("Wasm module aborted execution.");
      },
      trace: () => {
        /* AssemblyScript trace stub */
      }
    }
  };

  const { instance } = await WebAssembly.instantiate(wasmBinary, importObject);
  const exports = instance.exports as PatchExports;

  if (typeof exports.process !== "function") {
    throw new Error("Wasm module is missing the process export.");
  }

  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Wasm module is missing its memory export.");
  }

  const blockSize = enforceNumber(readGlobal(exports.BLOCK_SIZE), metadata.blockSize, "BLOCK_SIZE");
  const sampleRate = enforceNumber(
    readGlobal(exports.SAMPLE_RATE),
    metadata.sampleRate,
    "SAMPLE_RATE"
  );

  const blockBytes = blockSize * Float32Array.BYTES_PER_ELEMENT;
  const heapBaseGlobal = exports.__heap_base;
  const heapBase = typeof heapBaseGlobal === "number"
    ? heapBaseGlobal
    : typeof heapBaseGlobal === "object" && heapBaseGlobal !== null
      ? Number((heapBaseGlobal as WebAssembly.Global).valueOf())
      : 0;

  let ptrL = alignPointer(heapBase, 16);
  let ptrR = alignPointer(ptrL + blockBytes, 16);
  const requiredBytes = ptrR + blockBytes;
  ensureMemoryCapacity(memory, requiredBytes);

  const buffer = memory.buffer;
  const left = new Float32Array(buffer, ptrL, blockSize);
  const right = new Float32Array(buffer, ptrR, blockSize);

  const setParameter =
    typeof exports.setParameter === "function"
      ? exports.setParameter.bind(exports)
      : () => {
          /* no-op */
        };

  return {
    moduleName: metadata.moduleName,
    sampleRate,
    optimizer: metadata.optimizer,
    mathMode: metadata.mathMode,
    blockSize,
    parameterCount: metadata.parameterCount,
    left,
    right,
    processBlock: () => {
      exports.process(ptrL, ptrR);
    },
    setParameter: (index: number, value: number) => {
      if (index >= 0 && index < metadata.parameterCount) {
        setParameter(index | 0, value);
      }
    }
  };
}

function alignPointer(pointer: number, alignment: number): number {
  const mask = alignment - 1;
  return (pointer + mask) & ~mask;
}

function ensureMemoryCapacity(memory: WebAssembly.Memory, bytesNeeded: number): void {
  const currentBytes = memory.buffer.byteLength;
  if (bytesNeeded <= currentBytes) {
    return;
  }
  const additionalBytes = bytesNeeded - currentBytes;
  const pages = Math.ceil(additionalBytes / PAGE_BYTES);
  memory.grow(pages);
}

function readGlobal(value: number | WebAssembly.Global | undefined): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as WebAssembly.Global).valueOf());
  }
  return null;
}

function enforceNumber(
  exportedValue: number | null,
  fallback: number,
  name: string
): number {
  const candidate = exportedValue ?? fallback;
  if (!Number.isFinite(candidate)) {
    throw new Error(`Invalid ${name} reported by module.`);
  }
  return candidate;
}
