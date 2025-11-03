import type { NodeImplementation } from "@dsp/types";

const OUTPUT_IDS = ["out1", "out2", "out3", "out4"] as const;

const knobsNode: NodeImplementation = {
  manifest: {
    kind: "control.knobs",
    category: "control",
    label: "Knobs",
    inputs: [],
    outputs: OUTPUT_IDS.map((id, index) => ({
      id,
      name: `Knob ${index + 1}`,
      type: "audio",
    })),
    defaultParams: {
      knob1: 0,
      knob2: 0,
      knob3: 0,
      knob4: 0,
    },
    appearance: {
      width: 260,
      height: 180,
      icon: "sliders",
    },
    controls: OUTPUT_IDS.map((id, index) => ({
      id: `knob${index + 1}`,
      label: `Knob ${index + 1}`,
      type: "slider",
      min: -10,
      max: 10,
    })),
    renameableOutputs: true,
  },
  assembly: {
    emit(planNode, helpers) {
      const lines: string[] = [];
      lines.push(`// ${planNode.node.label} (${planNode.node.id})`);
      lines.push("{");
      planNode.outputs.forEach((output, index) => {
        const valueExpr = helpers.parameterRef(planNode.controls[index].index);
        const assignments = output.wires
          .map((wire) => `${wire.varName} = ${valueExpr};`)
          .join("\n");
        if (assignments) {
          lines.push(helpers.indentLines(assignments, 1));
        }
      });
      lines.push("}");
      return lines.join("\n");
    },
  },
};

export default knobsNode;
export { knobsNode as knobsNodeImplementation };
