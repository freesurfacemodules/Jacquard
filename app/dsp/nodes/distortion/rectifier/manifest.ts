import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";

export const rectifierNode: NodeImplementation = {
  manifest: {
    kind: "distortion.rectifier",
    category: "distortion",
    label: "Rectifier",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 200,
      height: 120,
      icon: "wave-square"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);

      if (!input || !output) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const expr = helpers.buildInputExpression(input);
      const assignments = output.wires.map((wire) => `${wire.varName} = rectified;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const rectified: f32 = Mathf.abs(${expr});`, 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};
