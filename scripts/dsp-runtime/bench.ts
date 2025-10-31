#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  resolveBenchCases,
  measureRuntime,
  summarizeBenchmarks,
  type BenchCaseInput,
  type BenchMetrics
} from "./harness";
import { resolvePath } from "./utils";
import type { MathMode } from "@codegen/assemblyscript";

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
  mathMode?: MathMode | "both";
  optimizer?: "asc" | "asc+binaryen" | "both";
  suiteName?: string;
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
    math?: MathMode | "both";
    optimizer?: "asc" | "asc+binaryen" | "both";
  }>;
}

function printUsage(): void {
  const scriptName = path.basename(process.argv[1] ?? "bench.ts");
  console.log(
    [
      `Usage: ${scriptName} [--patch <patch.json> | --config <config.json> | --suite <name>]`,
      "       [--label <label>] [--frames <count>] [--warmup <blocks>] [--iterations <blocks>]",
      "       [--wasm <module.wasm> --metadata <metadata.json>] [--module <name>]",
      "       [--math fast|baseline|both] [--optimizer asc|binaryen|both] [--json]",
      "",
      "Examples:",
      `  ${scriptName} --patch patches/fm-example.json --frames 96000 --math both`,
      `  ${scriptName} --config bench.config.json --json`,
      "",
      "Config file schema:",
      "  {",
      "    \"frames\": 96000,",
      "    \"warmupBlocks\": 32,",
      "    \"cases\": [",
      "      { \"label\": \"optimized\", \"patch\": \"patches/optimized.json\", \"math\": \"fast\" },",
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
      case "--suite": {
        options.suiteName = argv[++index];
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
      case "--math": {
        const value = (argv[++index] ?? "").toLowerCase();
        if (value === "fast" || value === "baseline" || value === "both") {
          options.mathMode = value as MathMode | "both";
        } else if (value) {
          console.warn(`Unknown --math value: ${value}`);
        }
        break;
      }
      case "--optimizer": {
        const value = (argv[++index] ?? "").toLowerCase();
        if (value === "asc" || value === "binaryen" || value === "both") {
          options.optimizer =
            value === "binaryen" ? "asc+binaryen" : (value as "asc" | "asc+binaryen" | "both");
        } else if (value) {
          console.warn(`Unknown --optimizer value: ${value}`);
        }
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

  if (!options.configPath && !options.patchPath && !options.wasmPath && !options.suiteName) {
    return null;
  }

  return options;
}

const PRESET_SUITES: Record<string, BenchCaseInput[]> = {
  nodes: [
    {
      label: "node-analog",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/analog-osc.json",
      mathMode: "fast"
    },
    {
      label: "node-sine",
      patchPath: "scripts/dsp-runtime/fixtures/sine.json",
      mathMode: "fast"
    },
    {
      label: "node-biquad",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/biquad-filter.json",
      mathMode: "fast"
    },
    {
      label: "node-ladder",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/ladder-filter.json",
      mathMode: "fast"
    },
    {
      label: "node-ddl",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/ddl-delay.json",
      mathMode: "fast"
    },
    {
      label: "node-waveguide",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/waveguide-delay.json",
      mathMode: "fast"
    },
    {
      label: "node-noise",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/noise-basic.json",
      mathMode: "fast"
    },
    {
      label: "node-softclip",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/softclip.json",
      mathMode: "fast"
    },
    {
      label: "node-slew",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/slew.json",
      mathMode: "fast"
    },
    {
      label: "node-clock",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/clock.json",
      mathMode: "fast"
    },
    {
      label: "node-seeded",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/seeded-random.json",
      mathMode: "fast"
    },
    {
      label: "node-envelope",
      patchPath: "scripts/dsp-runtime/fixtures/nodes/envelope-ad.json",
      mathMode: "fast"
    }
  ]
};

async function loadConfigCases(
  configPath: string
): Promise<{
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
    const optimizerValue = entry.optimizer;
    let optimizer: "asc" | "asc+binaryen" | "both" | undefined;
    if (optimizerValue === "binaryen") {
      optimizer = "asc+binaryen";
    } else if (
      optimizerValue === "asc" ||
      optimizerValue === "asc+binaryen" ||
      optimizerValue === "both"
    ) {
      optimizer = optimizerValue;
    }
    return {
      label: entry.label,
      patchPath: entry.patch,
      wasmPath: entry.wasm,
      metadataPath: entry.metadata,
      moduleName: entry.moduleName,
      mathMode: entry.math,
      optimizer
    };
  });
  return {
    cases,
    frames: parsed.frames,
    warmupBlocks: parsed.warmupBlocks,
    iterations: parsed.iterations
  };
}

async function resolveCliCases(
  options: BenchCliOptions
): Promise<{
  cases: BenchCaseInput[];
  frames?: number;
  warmupBlocks?: number;
  iterations?: number;
}> {
  if (options.configPath) {
    return loadConfigCases(options.configPath);
  }

  if (options.suiteName) {
    const preset = PRESET_SUITES[options.suiteName];
    if (!preset) {
      throw new Error(`Unknown benchmark suite: ${options.suiteName}`);
    }

    const suiteCases = preset.map((entry) => ({ ...entry }));
    if (options.mathMode) {
      for (const entry of suiteCases) {
        entry.mathMode = options.mathMode;
      }
    }
    if (options.optimizer) {
      for (const entry of suiteCases) {
        entry.optimizer = options.optimizer;
      }
    }

    return {
      cases: suiteCases,
      frames: options.frames,
      warmupBlocks: options.warmupBlocks,
      iterations: options.iterations
    };
  }

  const label = options.label ?? "case";
  const singleCase: BenchCaseInput = {
    label,
    patchPath: options.patchPath,
    wasmPath: options.wasmPath,
    metadataPath: options.metadataPath,
    moduleName: options.moduleName,
    mathMode: options.mathMode,
    optimizer: options.optimizer
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

function formatCaseDetails(metric: BenchMetrics, baseline?: BenchMetrics): string {
  const lines = [
    `Case: ${metric.caseLabel}`,
    `  Module: ${metric.moduleName}`,
    `  Math: ${metric.mathMode}`,
    `  Optimizer: ${metric.optimizer}`,
    `  Sample rate: ${metric.sampleRate} Hz`,
    `  Block size: ${metric.blockSize} frames`,
    `  Frames: ${metric.frames}`,
    `  Blocks: ${metric.blocks}`,
    `  Duration: ${(metric.seconds * 1000).toFixed(3)} ms`,
    `  Frames/sec: ${metric.framesPerSecond.toFixed(2)}`,
    `  Blocks/sec: ${metric.blocksPerSecond.toFixed(2)}`,
    `  Avg block: ${metric.averageBlockMicros.toFixed(3)} µs`,
    `  Real-time ratio: ${metric.realtimeRatio.toFixed(3)}x`,
    `  Checksum: ${metric.checksum.toFixed(6)}`
  ];
  if (baseline && baseline !== metric) {
    const speedup = baseline.averageBlockMicros / metric.averageBlockMicros;
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

  const { cases, frames, warmupBlocks, iterations } = await resolveCliCases(options);

  const resolvedCases = await resolveBenchCases(cases);
  const metrics = resolvedCases.map((entry) =>
    measureRuntime(entry.label, entry.runtime, { frames, warmupBlocks, iterations })
  );

  const { baseline, table } = summarizeBenchmarks(metrics);

  if (options.json) {
    const payload = metrics.map((entry) => ({
      label: entry.caseLabel,
      moduleName: entry.moduleName,
      mathMode: entry.mathMode,
      optimizer: entry.optimizer,
      sampleRate: entry.sampleRate,
      blockSize: entry.blockSize,
      frames: entry.frames,
      blocks: entry.blocks,
      seconds: entry.seconds,
      framesPerSecond: entry.framesPerSecond,
      blocksPerSecond: entry.blocksPerSecond,
      averageBlockMicros: entry.averageBlockMicros,
      realtimeRatio: entry.realtimeRatio,
      checksum: entry.checksum,
      baselineLabel: baseline?.caseLabel ?? null,
      speedup: baseline && baseline !== entry
        ? baseline.averageBlockMicros / entry.averageBlockMicros
        : 1
    }));
    console.log(JSON.stringify({ metrics: payload, summaryTable: table }, null, 2));
    return;
  }

  for (const metric of metrics) {
    console.log(formatCaseDetails(metric, baseline ?? undefined));
  }

  if (table) {
    console.log("\nSummary:");
    console.log(table);
  }
}

main().catch((error) => {
  console.error("[bench:dsp] failed:", error);
  process.exitCode = 1;
});
