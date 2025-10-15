import type { CompileResult } from "@compiler/compiler";

export interface WorkletHandle {
  context: AudioContext;
  node: AudioWorkletNode;
}

const registeredModules = new WeakMap<AudioContext, Set<string>>();

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

  let registry = registeredModules.get(context);
  if (!registry) {
    registry = new Set<string>();
    registeredModules.set(context, registry);
  }

  if (registry.has(moduleUrl.href)) {
    return;
  }

  await context.audioWorklet.addModule(moduleUrl.href);
  registry.add(moduleUrl.href);
}
