import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_SIGNAL = "in";
const INPUT_GAIN = "gain";
const OUTPUT_SIGNAL = "out";
const CONTROL_LEVEL = "level";

const MIN_DB = -96;
const MAX_DB = 12;
const GAIN_INPUT_RANGE = 10.0;

export const gainDbNode: NodeImplementation = {
  manifest: {
    kind: "utility.gain",
    category: "utility",
    label: "Gain",
    inputs: [
      audioPort(INPUT_SIGNAL, "Signal"),
      audioPort(INPUT_GAIN, "Gain CV")
    ],
    outputs: [audioPort(OUTPUT_SIGNAL, "Out")],
    defaultParams: {
      [CONTROL_LEVEL]: 0
    },
    appearance: {
      width: 200,
      height: 180,
      icon: "waveform"
    },
    controls: [
      {
        id: CONTROL_LEVEL,
        label: "Level",
        type: "fader",
        min: MIN_DB,
        max: MAX_DB
      }
    ]
  },
  assembly: {
    emit(planNode, helpers) {
      const signalInput = planNode.inputs.find((input) => input.port.id === INPUT_SIGNAL);
      const gainInput = planNode.inputs.find((input) => input.port.id === INPUT_GAIN);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_SIGNAL);
      const levelControl = planNode.controls.find((control) => control.controlId === CONTROL_LEVEL);

      if (!output || !levelControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const inputExpr = signalInput
        ? helpers.buildInputExpression(signalInput)
        : helpers.numberLiteral(0);
      const gainExpr = gainInput ? helpers.buildInputExpression(gainInput) : helpers.numberLiteral(0);
      const levelExpr = helpers.parameterRef(levelControl.index);

      const gainDbVar = `gainDb_${helpers.sanitizeIdentifier(planNode.node.id)}`;
      const gainLinVar = `gainLin_${helpers.sanitizeIdentifier(planNode.node.id)}`;

      const lines: string[] = [];
      lines.push(`// ${planNode.node.label} (${planNode.node.id})`);
      lines.push("{");
      lines.push(helpers.indentLines(`let ${gainDbVar}: f32 = ${levelExpr} + (${gainExpr} * ${MAX_DB - MIN_DB} / ${GAIN_INPUT_RANGE});`, 1));
      lines.push(helpers.indentLines(`if (${gainDbVar} < ${MIN_DB}.0) ${gainDbVar} = ${MIN_DB}.0;`, 1));
      lines.push(helpers.indentLines(`if (${gainDbVar} > ${MAX_DB}.0) ${gainDbVar} = ${MAX_DB}.0;`, 1));
      lines.push(helpers.indentLines(`const ${gainLinVar}: f32 = fastExp(${gainDbVar} * (LN10 * 0.05));`, 1));
      lines.push(helpers.indentLines(`const scaled: f32 = (${inputExpr}) * ${gainLinVar};`, 1));
      lines.push(
        helpers.indentLines(
          output.wires.map((wire) => `${wire.varName} = scaled;`).join("\n") || "// No connections consuming the gain output.",
          1
        )
      );
      lines.push("}");

      return lines.join("\n");
    }
  }
};

export default gainDbNode;
