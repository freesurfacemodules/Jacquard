import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExecutionPlan } from "@codegen/plan";
import { emitAssemblyScript } from "@codegen/assemblyscript";
import { normalizePatchDocument } from "@graph/persistence";
import type { PatchDocument } from "@graph/persistence";
import type { PatchGraph } from "@graph/types";

export interface CompileOptions {
  moduleName?: string;
}

export interface CompileArtifacts {
  moduleName: string;
  graph: PatchGraph;
  plan: ExecutionPlan;
  source: string;
  wasmBinary: Uint8Array;
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
  const { source, plan } = emitAssemblyScript(graph, { moduleName });
  const wasmBinary = await compileAssemblyScriptToWasm(source);
  return {
    moduleName,
    graph,
    plan,
    source,
    wasmBinary
  };
}

export async function compilePatchFromFile(
  patchPath: string,
  options: CompileOptions = {}
): Promise<CompileArtifacts> {
  const graph = await readPatchGraph(patchPath);
  const moduleName =
    options.moduleName ?? defaultModuleNameFromPath(patchPath);
  return compilePatchGraph(graph, { moduleName });
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
    scopeMonitors: artifacts.plan.scopeMonitors
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
    noAssert: true
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
