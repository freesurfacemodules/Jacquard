import { NodeDescriptor } from "@graph/types";
import type { NodeImplementation } from "@dsp/types";
import { sineOscNode } from "@dsp/nodes/oscillator/sine/manifest";
import { stereoMixerNode } from "@dsp/nodes/mixer/stereo/manifest";
import { outputNode } from "@dsp/nodes/io/output/manifest";

const implementations: NodeImplementation[] = [
  sineOscNode,
  stereoMixerNode,
  outputNode
];

const implementationMap = new Map<string, NodeImplementation>();
const manifestMap = new Map<string, NodeImplementation["manifest"]>();

for (const implementation of implementations) {
  implementationMap.set(implementation.manifest.kind, implementation);
  manifestMap.set(implementation.manifest.kind, implementation.manifest);
}

export const nodeImplementations = implementations;

export const builtinNodes = implementations.map((impl) => impl.manifest);

export function getNodeImplementation(kind: string): NodeImplementation | undefined {
  return implementationMap.get(kind);
}

export function instantiateNode(kind: string, id: string): NodeDescriptor {
  const manifest = manifestMap.get(kind);
  if (!manifest) {
    throw new Error(`Unknown node kind: ${kind}`);
  }

  return {
    id,
    kind: manifest.kind,
    label: manifest.label,
    inputs: manifest.inputs.map((port) => ({ ...port })),
    outputs: manifest.outputs.map((port) => ({ ...port })),
    parameters: { ...(manifest.defaultParams ?? {}) }
  };
}
