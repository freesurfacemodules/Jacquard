import { NodeDescriptor } from "@graph/types";
import type { NodeImplementation } from "@dsp/types";
import { analogOscillatorNode } from "@dsp/nodes/oscillator/analog/manifest";
import { sineOscNode } from "@dsp/nodes/oscillator/sine/manifest";
import { stereoMixerNode } from "@dsp/nodes/mixer/stereo/manifest";
import { outputNode } from "@dsp/nodes/io/output/manifest";
import { gainNode } from "@dsp/nodes/utility/gain/manifest";
import { ddlDelayNode } from "@dsp/nodes/delay/ddl/manifest";
import { waveguideDelayNode } from "@dsp/nodes/delay/waveguide/manifest";
import { clockNode } from "@dsp/nodes/clock/manifest";
import { biquadNode } from "@dsp/nodes/filter/biquad/manifest";
import { ladderFilterNode } from "@dsp/nodes/filter/ladder/manifest";
import { allpassFilterNode } from "@dsp/nodes/filter/allpass/manifest";
import { noiseNode } from "@dsp/nodes/noise/basic/manifest";
import { adEnvelopeNode } from "@dsp/nodes/envelope/ad/manifest";
import { slewLimiterNode } from "@dsp/nodes/utility/slew/manifest";
import { oscilloscopeNode } from "@dsp/nodes/utility/scope/manifest";
import { softclipNode } from "@dsp/nodes/utility/softclip/manifest";
import { rectifierNode } from "@dsp/nodes/distortion/rectifier/manifest";
import { dcBiasNode } from "@dsp/nodes/utility/dcbias/manifest";
import { multiplexerNode } from "@dsp/nodes/utility/mux/manifest";
import { demultiplexerNode } from "@dsp/nodes/utility/demux/manifest";
import { sampleHoldNode } from "@dsp/nodes/utility/samplehold/manifest";
import { andNode } from "@dsp/nodes/logic/and/manifest";
import { orNode } from "@dsp/nodes/logic/or/manifest";
import { notNode } from "@dsp/nodes/logic/not/manifest";
import { xorNode } from "@dsp/nodes/logic/xor/manifest";
import { counterNode } from "@dsp/nodes/logic/counter/manifest";
import { subpatchNode } from "@dsp/nodes/logic/subpatch/manifest";
import { subpatchInputNode } from "@dsp/nodes/logic/subpatch/input";
import { subpatchOutputNode } from "@dsp/nodes/logic/subpatch/output";
import { comparatorNode } from "@dsp/nodes/logic/comparator/manifest";
import { addNode } from "@dsp/nodes/math/add/manifest";
import { subtractNode } from "@dsp/nodes/math/subtract/manifest";
import { multiplyNode } from "@dsp/nodes/math/multiply/manifest";
import { seededRandomNode } from "@dsp/nodes/random/seeded/manifest";
import { complexResonatorNode } from "@dsp/nodes/resonator/complex/manifest";
import { knobsNodeImplementation } from "@dsp/nodes/utility/knobs/manifest";

const implementations: NodeImplementation[] = [
  analogOscillatorNode,
  sineOscNode,
  stereoMixerNode,
  gainNode,
  clockNode,
  ddlDelayNode,
  waveguideDelayNode,
  biquadNode,
  ladderFilterNode,
  allpassFilterNode,
  adEnvelopeNode,
  noiseNode,
  slewLimiterNode,
  softclipNode,
  rectifierNode,
  dcBiasNode,
  multiplexerNode,
  demultiplexerNode,
  sampleHoldNode,
  oscilloscopeNode,
  andNode,
  orNode,
  notNode,
  xorNode,
  comparatorNode,
  counterNode,
  subpatchNode,
  subpatchInputNode,
  subpatchOutputNode,
  addNode,
  subtractNode,
  multiplyNode,
  seededRandomNode,
  complexResonatorNode,
  knobsNodeImplementation,
  outputNode
];

const implementationMap = new Map<string, NodeImplementation>();
const manifestMap = new Map<string, NodeImplementation["manifest"]>();

for (const implementation of implementations) {
  implementationMap.set(implementation.manifest.kind, implementation);
  manifestMap.set(implementation.manifest.kind, implementation.manifest);
}

export const nodeImplementations = implementations;

export const builtinNodes = implementations
  .map((impl) => impl.manifest)
  .filter((manifest) => !manifest.hidden);

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
    parameters: { ...(manifest.defaultParams ?? {}) },
    metadata: {}
  };
}
