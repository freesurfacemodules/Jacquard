import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const CHANNEL_IN = "in";
const CHANNEL_GAIN = "gain";
const CHANNEL_OFFSET = "offset";
const CHANNEL_OUT = "out";

export const gainNode: NodeImplementation = {
  manifest: {
    kind: "utility.gain",
    category: "utility",
    label: "Gain",
    inputs: [
      audioPort(CHANNEL_IN, "In"),
      audioPort(CHANNEL_GAIN, "Gain")
    ],
    outputs: [audioPort(CHANNEL_OUT, "Out")],
    defaultParams: {
      [CHANNEL_GAIN]: 1,
      [CHANNEL_OFFSET]: 0
    },
    controls: [
      {
        id: CHANNEL_GAIN,
        label: "Gain",
        type: "slider",
        min: 0,
        max: 10,
        step: 0.1
      },
      {
        id: CHANNEL_OFFSET,
        label: "Offset",
        type: "slider",
        min: -10,
        max: 10,
        step: 0.01
      }
    ]
  },
  assembly: {
    emit(planNode, helpers) {
      const input = planNode.inputs.find((port) => port.port.id === CHANNEL_IN);
      const gain = planNode.inputs.find((port) => port.port.id === CHANNEL_GAIN);
      const output = planNode.outputs.find((port) => port.port.id === CHANNEL_OUT);
      const offsetControl = planNode.controls.find(
        (control) => control.controlId === CHANNEL_OFFSET
      );
      const gainControl = planNode.controls.find(
        (control) => control.controlId === CHANNEL_GAIN
      );

      if (!output) {
        return `// ${planNode.node.label} (${planNode.node.id}) has no output.`;
      }

      const inputExpr = input
        ? helpers.buildInputExpression(input)
        : helpers.numberLiteral(0);
      const gainExpr = gain && gain.wires.length > 0
        ? helpers.buildInputExpression(gain)
        : gainControl
        ? helpers.parameterRef(gainControl.index)
        : helpers.numberLiteral(1);
      const offsetExpr = offsetControl
        ? helpers.parameterRef(offsetControl.index)
        : helpers.numberLiteral(0);

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`let scaled: f32 = (${inputExpr}) * (${gainExpr});`, 1),
        helpers.indentLines(`let result: f32 = scaled + (${offsetExpr});`, 1),
        helpers.indentLines(
          output.wires
            .map((wire) => `${wire.varName} = result;`)
            .join("\n") || "// No connections consuming the gain output.",
          1
        )
      ];

      if (helpers.autoRoute.left === planNode.node.id) {
        lines.push(helpers.indentLines(`${helpers.autoLeftVar} = result;`, 1));
      }
      if (helpers.autoRoute.right === planNode.node.id) {
        lines.push(helpers.indentLines(`${helpers.autoRightVar} = result;`, 1));
      }

      lines.push("}");
      return lines.join("\n");
    }
  }
};
