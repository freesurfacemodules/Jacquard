import { instantiate } from "@assemblyscript/loader";
import { emitAssemblyScript } from "@codegen/assemblyscript";
import type { PlanControl, EnvelopeMonitor } from "@codegen/plan";
import { PatchGraph } from "@graph/types";

export interface CompileResult {
  moduleSource: string;
  wasmBinary: Uint8Array;
  parameterBindings: PlanControl[];
  envelopeMonitors: EnvelopeMonitor[];
}

/**
 * compilePatch converts a patch graph to AssemblyScript and compiles it
 * to a WebAssembly binary. Compilation happens on the main thread for now;
 * a Worker bridge will be wired up once the evaluator is ready.
 */
export async function compilePatch(graph: PatchGraph): Promise<CompileResult> {
  console.info("[MaxWasm] emitAssemblyScript begin");
  const { source: moduleSource, plan } = emitAssemblyScript(graph);
  console.info("[MaxWasm] emitAssemblyScript done", {
    controls: plan.controls.length,
    nodes: plan.nodes.length
  });

  const ascModule = await import("assemblyscript/asc");
  const compileString = (ascModule as {
    compileString?: typeof import("assemblyscript/asc").compileString;
  }).compileString;
  if (!compileString) {
    throw new Error("AssemblyScript compiler is unavailable in this environment.");
  }

  const { binary, stderr, stdout } = await compileString(moduleSource, {
    optimizeLevel: 3,
    shrinkLevel: 1,
    noAssert: true
  });
  console.info("[MaxWasm] asc compileString finished", {
    hasBinary: !!binary,
    binaryLength: binary?.length ?? 0
  });

  if (!binary) {
    const stderrText = typeof stderr?.toString === "function" ? stderr.toString() : "";
    const stdoutText = typeof stdout?.toString === "function" ? stdout.toString() : "";
    throw new Error(
      `AssemblyScript compilation failed: no binary output.\nstdout: ${stdoutText}\nstderr: ${stderrText}`
    );
  }

  const wasmBinary =
    binary instanceof Uint8Array ? binary : new Uint8Array(binary);

  // Quick sanity check: ensure the module can instantiate.
  await instantiate(wasmBinary, {});

  return {
    moduleSource,
    wasmBinary,
    parameterBindings: plan.controls,
    envelopeMonitors: plan.envelopeMonitors
  };
}
