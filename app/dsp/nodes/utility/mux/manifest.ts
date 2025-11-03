import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_A = "a";
const INPUT_B = "b";
const INPUT_SEL = "sel";
const OUTPUT_PORT = "out";

export const multiplexerNode: NodeImplementation = {
  manifest: {
    kind: "circuit.mux",
    category: "circuit",
    label: "2x1 Mux",
    inputs: [
      audioPort(INPUT_A, "Signal A"),
      audioPort(INPUT_B, "Signal B"),
      audioPort(INPUT_SEL, "Select")
    ],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 220,
      height: 160,
      icon: "square-split-vertical"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const inputA = planNode.inputs.find((entry) => entry.port.id === INPUT_A);
      const inputB = planNode.inputs.find((entry) => entry.port.id === INPUT_B);
      const inputSel = planNode.inputs.find((entry) => entry.port.id === INPUT_SEL);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);

      if (!inputA || !inputB || !inputSel || !output) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const exprA = helpers.buildInputExpression(inputA);
      const exprB = helpers.buildInputExpression(inputB);
      const exprSel = helpers.buildInputExpression(inputSel);
      const assignments = output.wires.map((wire) => `${wire.varName} = muxOut;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const sel: f32 = ${exprSel};`, 1),
        helpers.indentLines(`const muxOut: f32 = sel < 0.5 ? (${exprA}) : (${exprB});`, 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

export default multiplexerNode;
