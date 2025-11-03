import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";

export const dcBiasNode: NodeImplementation = {
  manifest: {
    kind: "filter.dcblock",
    category: "filter",
    label: "DC Block",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 200,
      height: 140,
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

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const filterVar = `dcblock_${identifier}`;
      const inputExpr = helpers.buildInputExpression(input);
      const assignments = output.wires.map((wire) => `${wire.varName} = dcSample;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const inputSample: f32 = ${inputExpr};`, 1),
        helpers.indentLines(`const dcSample: f32 = ${filterVar}.process(inputSample);`, 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

export default dcBiasNode;
