import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";

export const outputNode: NodeImplementation = {
  manifest: {
    kind: "io.output",
    category: "io",
    label: "Output",
    inputs: [audioPort("left", "Left"), audioPort("right", "Right")],
    outputs: [],
    appearance: {
      width: 180,
      height: 120,
      icon: "speaker"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const leftInput = planNode.inputs.find((input) => input.port.id === "left");
      const rightInput = planNode.inputs.find((input) => input.port.id === "right");

      const leftExpr = leftInput
        ? helpers.buildInputExpression(leftInput)
        : helpers.numberLiteral(0);

      const rightExpr = rightInput
        ? helpers.buildInputExpression(rightInput)
        : helpers.numberLiteral(0);

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`let outLeft: f32 = ${leftExpr};`, 1),
        helpers.indentLines(`let outRight: f32 = ${rightExpr};`, 1),
        helpers.indentLines("pushOutputSamples(outLeft, outRight);", 1),
        "}"
      ].join("\n");
    }
  }
};
