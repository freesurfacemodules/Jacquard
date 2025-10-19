import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";

export const notNode: NodeImplementation = {
  manifest: {
    kind: "logic.not",
    category: "logic",
    label: "NOT Gate",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 200,
      height: 140,
      icon: "binary"
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

      const assignments = output.wires
        .map((wire) => `${wire.varName} = result;`)
        .join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const inputValue: f32 = ${expr};`, 1),
        helpers.indentLines("const isFalse: bool = inputValue < 1.0;", 1),
        helpers.indentLines("const result: f32 = isFalse ? 5.0 : 0.0;", 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};
