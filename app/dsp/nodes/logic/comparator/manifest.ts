import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_A = "a";
const INPUT_B = "b";
const OUTPUT_PORT = "out";

export const comparatorNode: NodeImplementation = {
  manifest: {
    kind: "logic.comparator",
    category: "logic",
    label: "Comparator",
    inputs: [
      audioPort(INPUT_A, "A"),
      audioPort(INPUT_B, "B")
    ],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 200,
      height: 140,
      icon: "binary"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const inputA = planNode.inputs.find((entry) => entry.port.id === INPUT_A);
      const inputB = planNode.inputs.find((entry) => entry.port.id === INPUT_B);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);

      if (!inputA || !inputB || !output) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const exprA = helpers.buildInputExpression(inputA);
      const exprB = helpers.buildInputExpression(inputB);
      const assignments = output.wires
        .map((wire) => `${wire.varName} = result;`)
        .join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const valueA: f32 = ${exprA};`, 1),
        helpers.indentLines(`const valueB: f32 = ${exprB};`, 1),
        helpers.indentLines("const result: f32 = valueA > valueB ? 5.0 : 0.0;", 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

export default comparatorNode;
