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
  const wasmArray =
    artifact.wasmBinary instanceof Uint8Array
      ? artifact.wasmBinary
      : new Uint8Array(artifact.wasmBinary);

  const wasmBinary = wasmArray.buffer.slice(
    wasmArray.byteOffset,
    wasmArray.byteOffset + wasmArray.byteLength
  );

  const node = new AudioWorkletNode(context, "maxwasm-patch", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      wasmBinary,
      moduleSource: artifact.moduleSource
    }
  });

  if (typeof node.port.start === "function") {
    node.port.start();
  }

  try {
    await waitForProcessorReady(node);
  } catch (error) {
    try {
      node.disconnect();
    } catch (disconnectError) {
      console.warn("Failed to disconnect AudioWorkletNode", disconnectError);
    }
    try {
      node.port.close();
    } catch (closeError) {
      /* ignore */
    }
    throw error;
  }

  
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

async function waitForProcessorReady(node: AudioWorkletNode): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleMessage = (event: MessageEvent): void => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }

      if (data.type === "ready") {
        cleanup();
        resolve();
      } else if (data.type === "error") {
        const message =
          typeof data.message === "string"
            ? data.message
            : "Audio processor failed to initialize.";
        cleanup();
        reject(new Error(message));
      }
    };

    const cleanup = (): void => {
      node.port.removeEventListener("message", handleMessage);
    };

    node.port.addEventListener("message", handleMessage);
  });
}
