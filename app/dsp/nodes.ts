import { NodeDescriptor, PortDescriptor } from "@graph/types";

export interface DspNodeManifest {
  kind: string;
  category: "oscillator" | "filter" | "io" | "utility" | "math";
  label: string;
  inputs: PortDescriptor[];
  outputs: PortDescriptor[];
  defaultParams?: Record<string, number>;
}

const audioPort = (id: string, name: string): PortDescriptor => ({
  id,
  name,
  type: "audio"
});

export const builtinNodes: DspNodeManifest[] = [
  {
    kind: "osc.sine",
    category: "oscillator",
    label: "Sine Oscillator",
    inputs: [audioPort("pitch", "Pitch (oct)")],
    outputs: [audioPort("out", "Out")],
    defaultParams: {
      pitch: 0
    }
  },
  {
    kind: "mixer.stereo",
    category: "utility",
    label: "Stereo Mixer",
    inputs: [
      audioPort("ch1", "Channel 1"),
      audioPort("ch2", "Channel 2"),
      audioPort("ch3", "Channel 3"),
      audioPort("ch4", "Channel 4")
    ],
    outputs: [audioPort("left", "Left"), audioPort("right", "Right")],
    defaultParams: {
      gain_ch1: 1,
      gain_ch2: 1,
      gain_ch3: 1,
      gain_ch4: 1,
      pan_ch1: 0,
      pan_ch2: 0,
      pan_ch3: 0,
      pan_ch4: 0
    }
  },
  {
    kind: "filter.biquad",
    category: "filter",
    label: "Biquad Low-pass",
    inputs: [
      audioPort("in", "In"),
      audioPort("cutoff", "Cutoff"),
      audioPort("q", "Q")
    ],
    outputs: [audioPort("out", "Out")]
  },
  {
    kind: "io.output",
    category: "io",
    label: "Output",
    inputs: [audioPort("left", "Left"), audioPort("right", "Right")],
    outputs: []
  }
];

export function instantiateNode(kind: string, id: string): NodeDescriptor {
  const manifest = builtinNodes.find((node) => node.kind === kind);
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
