import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import softclipSource from "./softclip.as?raw";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";
const INPUT_GAIN_CONTROL = "inputGain";
const OUTPUT_GAIN_CONTROL = "outputGain";

export const softclipNode: NodeImplementation = {
  manifest: {
    kind: "utility.softclip",
    category: "utility",
    label: "Soft Clip",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    defaultParams: {
      [INPUT_GAIN_CONTROL]: 0,
      [OUTPUT_GAIN_CONTROL]: 0
    },
    appearance: {
      width: 200,
      height: 140,
      icon: "wave-square"
    },
    controls: [
      {
        id: INPUT_GAIN_CONTROL,
        label: "Input Gain (dB)",
        type: "slider",
        min: -60,
        max: 24,
        step: 0.1
      },
      {
        id: OUTPUT_GAIN_CONTROL,
        label: "Output Gain (dB)",
        type: "slider",
        min: -60,
        max: 24,
        step: 0.1
      }
    ]
  },
  assembly: {
    declarations: softclipSource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const inputGainControl = planNode.controls.find(
        (entry) => entry.controlId === INPUT_GAIN_CONTROL
      );
      const outputGainControl = planNode.controls.find(
        (entry) => entry.controlId === OUTPUT_GAIN_CONTROL
      );

      if (!output || !inputGainControl || !outputGainControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const inputExpr = input ? helpers.buildInputExpression(input) : helpers.numberLiteral(0);
      const inputGainExpr = helpers.parameterRef(inputGainControl.index);
      const outputGainExpr = helpers.parameterRef(outputGainControl.index);

      const assignments = output.wires.map((wire) => `${wire.varName} = shaped;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `const rawSample: f32 = ${inputExpr};`,
            `const shaped: f32 = softclipSample(rawSample, ${inputGainExpr}, ${outputGainExpr});`
          ].join("\n"),
          1
        ),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ].filter(Boolean);

      return lines.join("\n");
    }
  }
};
