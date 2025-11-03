import type { NodeImplementation } from "@dsp/types";

export const subpatchNode: NodeImplementation = {
  manifest: {
    kind: "meta.subpatch",
    category: "meta",
    label: "Subpatch",
    inputs: [],
    outputs: [],
    appearance: {
      width: 300,
      height: 200,
      icon: "folder",
    },
  },
};

export default subpatchNode;
