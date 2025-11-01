import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExecutionPlan } from "@codegen/plan";
import { emitAssemblyScript, type MathMode } from "@codegen/assemblyscript";
import { normalizePatchDocument } from "@graph/persistence";
import type { PatchDocument } from "@graph/persistence";
import type { PatchGraph } from "@graph/types";

export interface CompileOptions {
  moduleName?: string;
  mathMode?: MathMode;
  optimizeWithBinaryen?: boolean;
  binaryenOptions?: Partial<BinaryenOptimizeOptions>;
}

export interface CompileArtifacts {
  moduleName: string;
  graph: PatchGraph;
  plan: ExecutionPlan;
  source: string;
  wasmBinary: Uint8Array;
  mathMode: MathMode;
  optimizer: "asc" | "asc+binaryen";
}

export interface BuildOutputs extends CompileArtifacts {
  outDir: string;
  sourcePath: string;
  wasmPath: string;
  metadataPath: string;
}

export interface RuntimeMetadata {
  moduleName: string;
  sampleRate: number;
  blockSize: number;
  oversampling: number;
  parameterCount: number;
  controls: ExecutionPlan["controls"];
  envelopeMonitors: ExecutionPlan["envelopeMonitors"];
  scopeMonitors: ExecutionPlan["scopeMonitors"];
  mathMode: MathMode;
  optimizer: "asc" | "asc+binaryen";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolvePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.normalize(path.join(process.cwd(), inputPath));
}

export function defaultModuleNameFromPath(filePath: string): string {
  const { name } = path.parse(filePath);
  return sanitizeModuleName(name);
}

export function sanitizeModuleName(candidate: string): string {
  const trimmed = candidate.trim();
  const fallback = "maxwasm_patch";
  if (!trimmed) {
    return fallback;
  }
  const sanitized = trimmed.replace(/[^A-Za-z0-9_]+/g, "_");
  return sanitized.length > 0 ? sanitized : fallback;
}

export async function readPatchGraph(filePath: string): Promise<PatchGraph> {
  const absolute = resolvePath(filePath);
  const contents = await fs.readFile(absolute, "utf8");
  const parsed = JSON.parse(contents) as unknown;
  const document = normalizePatchDocument(parsed) as PatchDocument;
  return document.graph;
}

export async function compilePatchGraph(
  graph: PatchGraph,
  options: CompileOptions = {}
): Promise<CompileArtifacts> {
  const moduleName =
    options.moduleName ?? sanitizeModuleName(graph.nodes[0]?.id ?? "maxwasm_patch");
  const mathMode: MathMode = options.mathMode ?? "fast";
  const { source, plan } = emitAssemblyScript(graph, { moduleName, mathMode });
  let wasmBinary = await compileAssemblyScriptToWasm(source);
  let optimizer: "asc" | "asc+binaryen" = "asc";
  if (options.optimizeWithBinaryen) {
    const { binary, applied } = await applyBinaryenOptimizations(
      wasmBinary,
      options.binaryenOptions
    );
    wasmBinary = binary;
    optimizer = applied ? "asc+binaryen" : "asc";
  }
  return {
    moduleName,
    graph,
    plan,
    source,
    wasmBinary,
    mathMode,
    optimizer
  };
}

export async function compilePatchFromFile(
  patchPath: string,
  options: CompileOptions = {}
): Promise<CompileArtifacts> {
  const graph = await readPatchGraph(patchPath);
  const moduleName =
    options.moduleName ?? defaultModuleNameFromPath(patchPath);
  return compilePatchGraph(graph, {
    moduleName,
    mathMode: options.mathMode,
    optimizeWithBinaryen: options.optimizeWithBinaryen,
    binaryenOptions: options.binaryenOptions
  });
}

export async function writeBuildOutputs(
  artifacts: CompileArtifacts,
  outDir: string
): Promise<BuildOutputs> {
  const absoluteOut = resolvePath(outDir);
  await fs.mkdir(absoluteOut, { recursive: true });

  const sourcePath = path.join(absoluteOut, `${artifacts.moduleName}.ts`);
  const wasmPath = path.join(absoluteOut, `${artifacts.moduleName}.wasm`);
  const metadataPath = path.join(absoluteOut, `${artifacts.moduleName}.metadata.json`);

  await fs.writeFile(sourcePath, artifacts.source, "utf8");
  await fs.writeFile(wasmPath, artifacts.wasmBinary);
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      buildRuntimeMetadata(artifacts),
      null,
      2
    ),
    "utf8"
  );

  return {
    ...artifacts,
    outDir: absoluteOut,
    sourcePath,
    wasmPath,
    metadataPath
  };
}

export function buildRuntimeMetadata(artifacts: CompileArtifacts): RuntimeMetadata {
  return {
    moduleName: artifacts.moduleName,
    sampleRate: artifacts.graph.sampleRate,
    blockSize: artifacts.graph.blockSize,
    oversampling: artifacts.graph.oversampling,
    parameterCount: artifacts.plan.parameterCount,
    controls: artifacts.plan.controls,
    envelopeMonitors: artifacts.plan.envelopeMonitors,
    scopeMonitors: artifacts.plan.scopeMonitors,
    mathMode: artifacts.mathMode,
    optimizer: artifacts.optimizer
  };
}

async function compileAssemblyScriptToWasm(source: string): Promise<Uint8Array> {
  const ascModule = await import("assemblyscript/asc");
  const compileString = (ascModule as {
    compileString?: typeof import("assemblyscript/asc").compileString;
  }).compileString;

  if (!compileString) {
    throw new Error("AssemblyScript compiler is unavailable in this environment.");
  }

  const result = await compileString(source, {
    optimizeLevel: 3,
    shrinkLevel: 1,
    noAssert: true,
    enable: ["simd"]
  });

  if (!result.binary) {
    const stderr = typeof result.stderr?.toString === "function" ? result.stderr.toString() : "";
    const stdout = typeof result.stdout?.toString === "function" ? result.stdout.toString() : "";
    throw new Error(
      `AssemblyScript compilation failed: no binary output.\nstdout: ${stdout}\nstderr: ${stderr}`
    );
  }

  return result.binary instanceof Uint8Array
    ? result.binary
    : new Uint8Array(result.binary);
}

interface BinaryenOptimizeOptions {
  optimizeLevel: number;
  shrinkLevel: number;
  fastMath: boolean;
  enableSimd: boolean;
  passes: string[];
}

async function applyBinaryenOptimizations(
  wasmBinary: Uint8Array,
  options: Partial<BinaryenOptimizeOptions> = {}
): Promise<{ binary: Uint8Array; applied: boolean }> {
  let binaryen: typeof import("binaryen") | null = null;
  try {
    binaryen = await import("binaryen");
  } catch {
    console.warn(
      "[bench] Binaryen not installed; skipping post-AssemblyScript wasm-opt optimization."
    );
    return { binary: wasmBinary, applied: false };
  }

  const {
    optimizeLevel = 3,
    shrinkLevel = 0,
    fastMath = true,
    enableSimd = true,
    passes = [
      "inlining-optimizing",
      "flatten",
      "precompute",
      "precompute-propagate",
      "reorder-locals",
      "dce",
      "simplify-globals",
      "vacuum",
      "strip-debug",
      "strip-producers"
    ]
  } = options;

  binaryen.setOptimizeLevel(optimizeLevel);
  binaryen.setShrinkLevel(shrinkLevel);
  binaryen.setFastMath(fastMath);
  if (typeof (binaryen as any).setClosedWorld === "function") {
    (binaryen as any).setClosedWorld(true);
  }

  const module = binaryen.readBinary(wasmBinary);
  if (typeof module.setFeatures === "function" && (binaryen as any).Features) {
    try {
      const featuresEnum = (binaryen as any).Features;
      const allFeatures =
        featuresEnum?.All ??
        featuresEnum?.ALL ??
        (featuresEnum.MV || featuresEnum.Mvp || 0) |
          (featuresEnum.SIMD ?? featuresEnum.Simd ?? 0) |
          (featuresEnum.BulkMemory ?? featuresEnum.BULK_MEMORY ?? 0) |
          (featuresEnum.Multivalue ?? featuresEnum.MULTIVALUE ?? 0) |
          (featuresEnum.TailCall ?? featuresEnum.TAIL_CALLS ?? 0) |
          0;
      if (allFeatures) {
        module.setFeatures(allFeatures);
      }
    } catch {
      /* ignore feature configuration issues */
    }
  }

  // Run Binaryen's standard optimizer then any extra passes.
  module.optimize();
  if (passes.length > 0) {
    module.runPasses(passes);
  }
  module.optimize();

  const optimized = module.emitBinary();
  module.dispose();
  const binary =
    optimized instanceof Uint8Array ? optimized : new Uint8Array(optimized);
  return { binary, applied: true };
}
