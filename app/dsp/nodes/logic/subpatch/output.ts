import type { NodeImplementation } from "@dsp/types";

export const subpatchOutputNode: NodeImplementation = {
  manifest: {
    kind: "meta.subpatch.output",
    category: "utility",
    label: "Subpatch Output",
    inputs: [],
    outputs: [],
    appearance: {
      width: 220,
      height: 160,
      icon: "sign-out"
    },
    hidden: true
  }
};

export default subpatchOutputNode;
