import process from "node:process";
import {
  compilePatchFromFile,
  buildRuntimeMetadata,
  defaultModuleNameFromPath,
  resolvePath,
  sanitizeModuleName
} from "./utils";
import {
  instantiatePatchRuntime,
  loadMetadata,
  loadWasmBinary,
  type PatchRuntime
} from "./runtime";
import type { RuntimeMetadata } from "./utils";
import type { MathMode } from "@codegen/assemblyscript";

export interface BenchCaseInput {
  label: string;
  patchPath?: string;
  wasmPath?: string;
  metadataPath?: string;
  moduleName?: string;
  mathMode?: MathMode | "both";
  optimizer?: "asc" | "asc+binaryen" | "both";
}

export interface BenchCaseResolved {
  label: string;
  runtime: PatchRuntime;
  metadata: RuntimeMetadata;
}

export interface BenchRunOptions {
  frames?: number;
  warmupBlocks?: number;
  iterations?: number;
}

export interface BenchMetrics {
  caseLabel: string;
  moduleName: string;
  mathMode: MathMode;
  optimizer: "asc" | "asc+binaryen";
  sampleRate: number;
  blockSize: number;
  frames: number;
  blocks: number;
  seconds: number;
  framesPerSecond: number;
  blocksPerSecond: number;
  averageBlockMicros: number;
  realtimeRatio: number;
  checksum: number;
}

export async function resolveBenchCases(
  inputs: BenchCaseInput[]
): Promise<BenchCaseResolved[]> {
  const resolved: BenchCaseResolved[] = [];
  for (const entry of inputs) {
    const expanded = expandMathModes(entry);
    for (const variant of expanded) {
      resolved.push(await createRuntime(variant));
    }
  }
  return resolved;
}

export async function createRuntime(
  input: BenchCaseInput
): Promise<BenchCaseResolved> {
  if (input.patchPath) {
    const patchPath = resolvePath(input.patchPath);
    const moduleName =
      input.moduleName && input.moduleName.length > 0
        ? sanitizeModuleName(input.moduleName)
        : defaultModuleNameFromPath(patchPath);
    const mathMode: MathMode =
      input.mathMode && input.mathMode !== "both" ? input.mathMode : "fast";
    const optimizerFlag =
      input.optimizer && input.optimizer !== "both" ? input.optimizer : "asc";
    const artifacts = await compilePatchFromFile(patchPath, {
      moduleName,
      mathMode,
      optimizeWithBinaryen: optimizerFlag === "asc+binaryen"
    });
    const metadata = buildRuntimeMetadata(artifacts);
    const runtime = await instantiatePatchRuntime(
      artifacts.wasmBinary,
      metadata
    );
    return { label: input.label, runtime, metadata };
  }

  if (input.wasmPath && input.metadataPath) {
    const wasm = await loadWasmBinary(input.wasmPath);
    const metadata = await loadMetadata(input.metadataPath);
    if (input.mathMode && input.mathMode !== "both") {
      metadata.mathMode = input.mathMode;
    }
    if (input.optimizer && input.optimizer !== "both") {
      metadata.optimizer = input.optimizer;
    }
    const runtime = await instantiatePatchRuntime(wasm, metadata);
    return { label: input.label, runtime, metadata };
  }

  throw new Error(
    `Benchmark case "${input.label}" is missing required inputs (patch or wasm+metadata).`
  );
}

export function measureRuntime(
  caseLabel: string,
  runtime: PatchRuntime,
  options: BenchRunOptions = {}
): BenchMetrics {
  const warmupBlocks = Math.max(0, options.warmupBlocks ?? 32);
  const iterations =
    options.iterations ??
    Math.max(
      1,
      Math.ceil((options.frames ?? runtime.blockSize * 128) / runtime.blockSize)
    );

  for (let i = 0; i < warmupBlocks; i += 1) {
    runtime.processBlock();
  }

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    runtime.processBlock();
  }
  const end = process.hrtime.bigint();

  const elapsedNs = Number(end - start);
  const seconds = elapsedNs / 1e9;
  const safeSeconds = seconds > 0 ? seconds : Number.EPSILON;
  const blocks = iterations;
  const frames = iterations * runtime.blockSize;
  const blocksPerSecond = blocks / safeSeconds;
  const framesPerSecond = frames / safeSeconds;
  const averageBlockMicros = (safeSeconds * 1e6) / blocks;
  const audioSeconds =
    runtime.sampleRate > 0 ? frames / runtime.sampleRate : 0;
  const realtimeRatio =
    safeSeconds > 0 && audioSeconds > 0
      ? audioSeconds / safeSeconds
      : Number.POSITIVE_INFINITY;

  const left = runtime.left;
  let checksum = 0;
  const sampleCount = Math.min(16, left.length);
  for (let i = 0; i < sampleCount; i += 1) {
    checksum += left[i];
  }

  return {
    caseLabel,
    moduleName: runtime.moduleName,
    mathMode: runtime.mathMode,
    optimizer: runtime.optimizer,
    sampleRate: runtime.sampleRate,
    blockSize: runtime.blockSize,
    frames,
    blocks,
    seconds: safeSeconds,
    framesPerSecond,
    blocksPerSecond,
    averageBlockMicros,
    realtimeRatio,
    checksum
  };
}

export function summarizeBenchmarks(
  metrics: BenchMetrics[]
): { baseline: BenchMetrics | null; table: string } {
  if (metrics.length === 0) {
    return { baseline: null, table: "" };
  }
  const baseline =
    metrics.find((entry) => entry.mathMode === "baseline") ?? metrics[0];
  const headers = [
    "Case",
    "Math",
    "Optimizer",
    "Blocks/sec",
    "Avg block (µs)",
    "Real-time ×",
    baseline ? `Speedup vs ${baseline.caseLabel}` : "Speedup"
  ];
  const rows = metrics.map((entry) => {
    const speedup =
      baseline && baseline !== entry
        ? baseline.averageBlockMicros / entry.averageBlockMicros
        : 1;
    return [
      entry.caseLabel,
      entry.mathMode,
      entry.optimizer,
      entry.blocksPerSecond.toFixed(2),
      entry.averageBlockMicros.toFixed(3),
      entry.realtimeRatio.toFixed(3),
      speedup.toFixed(3) + "x"
    ];
  });
  const widths = headers.map((header, column) =>
    Math.max(
      header.length,
      ...rows.map((row) => row[column].length)
    )
  );
  const formatRow = (cols: string[]) =>
    cols
      .map((col, index) => col.padEnd(widths[index], " "))
      .join("  ")
      .trimEnd();
  const tableLines = [
    formatRow(headers),
    formatRow(headers.map((header, index) => "-".repeat(widths[index])))
  ];
  for (const row of rows) {
    tableLines.push(formatRow(row));
  }
  return {
    baseline,
    table: tableLines.join("\n")
  };
}

function expandMathModes(input: BenchCaseInput): BenchCaseInput[] {
  const mathVariants =
    input.mathMode === "both"
      ? ([
          { ...input, mathMode: "baseline" as MathMode, label: `${input.label}/baseline` },
          { ...input, mathMode: "fast" as MathMode, label: `${input.label}/fast` }
        ] satisfies BenchCaseInput[])
      : [input];

  const optimizerVariants: BenchCaseInput[] = [];
  for (const variant of mathVariants) {
    if (variant.optimizer === "both") {
      optimizerVariants.push(
        { ...variant, optimizer: "asc", label: `${variant.label}/asc` },
        { ...variant, optimizer: "asc+binaryen", label: `${variant.label}/binaryen` }
      );
    } else {
      optimizerVariants.push(variant);
    }
  }
  return optimizerVariants;
}
