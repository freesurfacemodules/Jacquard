import type { NodeImplementation } from "@dsp/types";

export const subpatchInputNode: NodeImplementation = {
  manifest: {
    kind: "logic.subpatch.input",
    category: "utility",
    label: "Subpatch Input",
    inputs: [],
    outputs: [],
    appearance: {
      width: 220,
      height: 160,
      icon: "sign-in"
    },
    hidden: true
  }
};

export default subpatchInputNode;
