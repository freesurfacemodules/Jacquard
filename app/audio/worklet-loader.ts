import type { CompileResult } from "@compiler/compiler";

export interface WorkletHandle {
  context: AudioContext;
  node: AudioWorkletNode;
}

/**
 * Loads the patch processor into the provided AudioContext
 * and returns a handle that can be used to control playback.
 */
export async function loadPatchProcessor(
  context: AudioContext,
  artifact: CompileResult
): Promise<WorkletHandle> {
  await ensureWorkletModule(context);
  // TODO: Wire shared memory between JS and Wasm artifacts.
  const node = new AudioWorkletNode(context, "maxwasm-patch", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      wasmBinary: artifact.wasmBinary,
      moduleSource: artifact.moduleSource
    }
  });

  return { context, node };
}

async function ensureWorkletModule(context: AudioContext): Promise<void> {
  const moduleUrl = new URL("./processors/patch-processor.js", import.meta.url);
  if (!context.audioWorklet) {
    throw new Error("AudioWorklet is not available in this environment.");
  }

  const modules = (context.audioWorklet as unknown as { modules?: Set<string> })
    .modules;

  if (!modules || !modules.has(moduleUrl.href)) {
    await context.audioWorklet.addModule(moduleUrl.href);
    if (modules) {
      modules.add(moduleUrl.href);
    }
  }
}
