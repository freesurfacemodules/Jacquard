import type { NodeImplementation } from "@dsp/types";

export const subpatchNode: NodeImplementation = {
  manifest: {
    kind: "logic.subpatch",
    category: "logic",
    label: "Subpatch",
    inputs: [],
    outputs: [],
    appearance: {
      width: 260,
      height: 200,
      icon: "folder"
    }
  }
};

export default subpatchNode;
