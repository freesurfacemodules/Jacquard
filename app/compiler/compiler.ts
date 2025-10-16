import { instantiate } from "@assemblyscript/loader";
import { emitAssemblyScript } from "@codegen/assemblyscript";
import { PatchGraph } from "@graph/types";

export interface CompileResult {
  moduleSource: string;
  wasmBinary: Uint8Array;
}

/**
 * compilePatch converts a patch graph to AssemblyScript and compiles it
 * to a WebAssembly binary. Compilation happens on the main thread for now;
 * a Worker bridge will be wired up once the evaluator is ready.
 */
export async function compilePatch(graph: PatchGraph): Promise<CompileResult> {
  const moduleSource = emitAssemblyScript(graph);

  const ascModule = await import("assemblyscript/asc");
  const compileString = (ascModule as { compileString?: typeof import("assemblyscript/dist/asc.js").compileString }).compileString;
  if (!compileString) {
    throw new Error("AssemblyScript compiler is unavailable in this environment.");
  }

  const { binary } = await compileString(moduleSource, {
    optimizeLevel: 3,
    shrinkLevel: 1,
    noAssert: true
  });

  if (!binary) {
    throw new Error("AssemblyScript compilation failed: no binary output");
  }

  const wasmBinary =
    binary instanceof Uint8Array ? binary : new Uint8Array(binary);

  // Quick sanity check: ensure the module can instantiate.
  await instantiate(wasmBinary, {});

  return {
    moduleSource,
    wasmBinary
  };
}
