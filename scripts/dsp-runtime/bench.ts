#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildRuntimeMetadata,
  compilePatchFromFile,
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

interface BenchCliOptions {
  configPath?: string;
  patchPath?: string;
  wasmPath?: string;
  metadataPath?: string;
  label?: string;
  moduleName?: string;
  frames?: number;
  warmupBlocks?: number;
  iterations?: number;
  json?: boolean;
}

interface BenchConfigFile {
  frames?: number;
  warmupBlocks?: number;
  iterations?: number;
  cases: Array<{
    label: string;
    patch?: string;
    wasm?: string;
    metadata?: string;
    moduleName?: string;
  }>;
}

interface BenchCaseInput {
  label: string;
  patchPath?: string;
  wasmPath?: string;
  metadataPath?: string;
  moduleName?: string;
}

interface BenchCaseResolved {
  label: string;
  runtime: PatchRuntime;
  metadata: RuntimeMetadata;
}

interface BenchMetrics {
  caseLabel: string;
  moduleName: string;
  frames: number;
  blocks: number;
  seconds: number;
  framesPerSecond: number;
  blocksPerSecond: number;
  averageBlockMicros: number;
  checksum: number;
}

function printUsage(): void {
  const scriptName = path.basename(process.argv[1] ?? "bench.ts");
  console.log(
    [
      `Usage: ${scriptName} [--patch <patch.json> | --config <config.json>]`,
      "       [--label <label>] [--frames <count>] [--warmup <blocks>] [--iterations <blocks>]",
      "       [--wasm <module.wasm> --metadata <metadata.json>] [--module <name>] [--json]",
      "",
      "Examples:",
      `  ${scriptName} --patch patches/scope.json --frames 96000`,
      `  ${scriptName} --config bench.config.json --json`,
      "",
      "Config file schema:",
      "  {",
      "    \"frames\": 96000,",
      "    \"warmupBlocks\": 32,",
      "    \"cases\": [",
      "      { \"label\": \"optimized\", \"patch\": \"patches/optimized.json\" },",
      "      { \"label\": \"baseline\", \"wasm\": \"dist/baseline.wasm\", \"metadata\": \"dist/baseline.metadata.json\" }",
      "    ]",
      "  }"
    ].join("\n")
  );
}

function parseArgs(argv: string[]): BenchCliOptions | "help" | null {
  const options: BenchCliOptions = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--config": {
        options.configPath = argv[++index];
        break;
      }
      case "--patch": {
        options.patchPath = argv[++index];
        break;
      }
      case "--wasm": {
        options.wasmPath = argv[++index];
        break;
      }
      case "--metadata": {
        options.metadataPath = argv[++index];
        break;
      }
      case "--label": {
        options.label = argv[++index];
        break;
      }
      case "--module": {
        options.moduleName = argv[++index];
        break;
      }
      case "--frames": {
        options.frames = parseInt(argv[++index] ?? "", 10);
        break;
      }
      case "--warmup": {
        options.warmupBlocks = parseInt(argv[++index] ?? "", 10);
        break;
      }
      case "--iterations": {
        options.iterations = parseInt(argv[++index] ?? "", 10);
        break;
      }
      case "--json": {
        options.json = true;
        break;
      }
      case "--help":
      case "-h": {
        return "help";
      }
      default: {
        if (!options.patchPath && !arg.startsWith("-")) {
          options.patchPath = arg;
        } else {
          console.warn(`Unknown argument: ${arg}`);
        }
        break;
      }
    }
  }

  if (!options.configPath && !options.patchPath && !options.wasmPath) {
    return null;
  }

  return options;
}

async function loadConfigCases(configPath: string): Promise<{
  cases: BenchCaseInput[];
  frames?: number;
  warmupBlocks?: number;
  iterations?: number;
}> {
  const absolute = resolvePath(configPath);
  const raw = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(raw) as BenchConfigFile;
  if (!parsed.cases || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("Benchmark config requires at least one case.");
  }
  const cases: BenchCaseInput[] = parsed.cases.map((entry, index) => {
    if (!entry.label) {
      throw new Error(`Benchmark case at index ${index} is missing a label.`);
    }
    if (!entry.patch && !entry.wasm) {
      throw new Error(
        `Benchmark case "${entry.label}" must provide either a patch or a wasm path.`
      );
    }
    return {
      label: entry.label,
      patchPath: entry.patch,
      wasmPath: entry.wasm,
      metadataPath: entry.metadata,
      moduleName: entry.moduleName
    };
  });
  return {
    cases,
    frames: parsed.frames,
    warmupBlocks: parsed.warmupBlocks,
    iterations: parsed.iterations
  };
}

async function resolveCases(
  options: BenchCliOptions
): Promise<{ cases: BenchCaseInput[]; frames?: number; warmupBlocks?: number; iterations?: number }> {
  if (options.configPath) {
    return loadConfigCases(options.configPath);
  }

  const label = options.label ?? "case";
  const singleCase: BenchCaseInput = {
    label,
    patchPath: options.patchPath,
    wasmPath: options.wasmPath,
    metadataPath: options.metadataPath,
    moduleName: options.moduleName
  };

  if (!singleCase.patchPath && !singleCase.wasmPath) {
    throw new Error("Provide either --patch or --wasm/--metadata.");
  }

  if (singleCase.wasmPath && !singleCase.metadataPath) {
    throw new Error("Benchmarks that use --wasm must also provide --metadata.");
  }

  return {
    cases: [singleCase],
    frames: options.frames,
    warmupBlocks: options.warmupBlocks,
    iterations: options.iterations
  };
}

async function createRuntime(caseInput: BenchCaseInput): Promise<BenchCaseResolved> {
  if (caseInput.patchPath) {
    const patchPath = resolvePath(caseInput.patchPath);
    const moduleName =
      caseInput.moduleName && caseInput.moduleName.length > 0
        ? sanitizeModuleName(caseInput.moduleName)
        : defaultModuleNameFromPath(patchPath);
    console.log(`[bench:dsp] compiling patch "${caseInput.label}" (${patchPath})`);
    const artifacts = await compilePatchFromFile(patchPath, { moduleName });
    const metadata = buildRuntimeMetadata(artifacts);
    const runtime = await instantiatePatchRuntime(artifacts.wasmBinary, metadata);
    return { label: caseInput.label, runtime, metadata };
  }

  if (caseInput.wasmPath && caseInput.metadataPath) {
    const wasm = await loadWasmBinary(caseInput.wasmPath);
    const metadata = await loadMetadata(caseInput.metadataPath);
    console.log(`[bench:dsp] loading wasm for "${caseInput.label}" (${caseInput.wasmPath})`);
    const runtime = await instantiatePatchRuntime(wasm, metadata);
    return { label: caseInput.label, runtime, metadata };
  }

  throw new Error(`Benchmark case "${caseInput.label}" is missing required inputs.`);
}

function measureRuntime(
  caseLabel: string,
  runtime: PatchRuntime,
  options: { frames?: number; warmupBlocks?: number; iterations?: number }
): BenchMetrics {
  const warmupBlocks = Math.max(0, options.warmupBlocks ?? 32);
  const iterations =
    options.iterations ??
    Math.max(1, Math.ceil((options.frames ?? runtime.blockSize * 128) / runtime.blockSize));

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

  const left = runtime.left;
  let checksum = 0;
  const sampleCount = Math.min(16, left.length);
  for (let i = 0; i < sampleCount; i += 1) {
    checksum += left[i];
  }

  return {
    caseLabel,
    moduleName: runtime.moduleName,
    frames,
    blocks,
    seconds: safeSeconds,
    framesPerSecond,
    blocksPerSecond,
    averageBlockMicros,
    checksum
  };
}

function formatMetrics(metrics: BenchMetrics, baseline?: BenchMetrics): string {
  const lines = [
    `Case: ${metrics.caseLabel}`,
    `  Module: ${metrics.moduleName}`,
    `  Frames: ${metrics.frames}`,
    `  Blocks: ${metrics.blocks}`,
    `  Duration: ${(metrics.seconds * 1000).toFixed(3)} ms`,
    `  Frames/sec: ${metrics.framesPerSecond.toFixed(2)}`,
    `  Blocks/sec: ${metrics.blocksPerSecond.toFixed(2)}`,
    `  Avg block: ${metrics.averageBlockMicros.toFixed(3)} µs`,
    `  Checksum: ${metrics.checksum.toFixed(6)}`
  ];
  if (baseline && baseline !== metrics) {
    const speedup = baseline.averageBlockMicros / metrics.averageBlockMicros;
    lines.push(`  Speedup vs ${baseline.caseLabel}: ${speedup.toFixed(3)}x`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options || options === "help") {
    printUsage();
    process.exit(options === "help" ? 0 : 1);
    return;
  }

  const { cases, frames, warmupBlocks, iterations } = await resolveCases(options);

  const resolvedCases: BenchCaseResolved[] = [];
  for (const entry of cases) {
    resolvedCases.push(await createRuntime(entry));
  }

  const metrics = resolvedCases.map((entry) =>
    measureRuntime(entry.label, entry.runtime, { frames, warmupBlocks, iterations })
  );

  if (options.json) {
    const baseline = metrics[0];
    const payload = metrics.map((entry) => ({
      label: entry.caseLabel,
      moduleName: entry.moduleName,
      frames: entry.frames,
      blocks: entry.blocks,
      seconds: entry.seconds,
      framesPerSecond: entry.framesPerSecond,
      blocksPerSecond: entry.blocksPerSecond,
      averageBlockMicros: entry.averageBlockMicros,
      checksum: entry.checksum,
      baselineLabel: baseline.caseLabel,
      speedup: baseline === entry
        ? 1
        : baseline.averageBlockMicros / entry.averageBlockMicros
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const baselineMetrics = metrics[0];
  for (const entry of metrics) {
    console.log(formatMetrics(entry, baselineMetrics));
  }
}

main().catch((error) => {
  console.error("[bench:dsp] failed:", error);
  process.exitCode = 1;
});
