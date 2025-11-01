import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import allpassSource from "./allpass.as?raw";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";
const CUTOFF_CONTROL = "cutoff";

export const allpassFilterNode: NodeImplementation = {
  manifest: {
    kind: "filter.allpass",
    category: "filter",
    label: "Allpass Filter",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    defaultParams: {
      [CUTOFF_CONTROL]: 1000
    },
    appearance: {
      width: 220,
      height: 160,
      icon: "filter"
    },
    controls: [
      {
        id: CUTOFF_CONTROL,
        label: "Cutoff (Hz)",
        type: "slider",
        min: 20,
        max: 20000
      }
    ]
  },
  assembly: {
    declarations: allpassSource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const cutoffControl = planNode.controls.find((entry) => entry.controlId === CUTOFF_CONTROL);

      if (!input || !output || !cutoffControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const filterVar = `allpass_${identifier}`;
      const inputExpr = helpers.buildInputExpression(input);
      const cutoffExpr = helpers.parameterRef(cutoffControl.index);

      const assignments = output.wires
        .map((wire) => `${wire.varName} = outputSample;`)
        .join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `let cutoffHz: f32 = ${cutoffExpr};`,
            "if (cutoffHz < 20.0) cutoffHz = 20.0;",
            "const maxCutoff: f32 = SAMPLE_RATE * 0.45;",
            "if (cutoffHz > maxCutoff) cutoffHz = maxCutoff;",
            `${filterVar}.setCutoff(cutoffHz);`,
            `const inputSample: f32 = ${inputExpr};`,
            `const outputSample: f32 = ${filterVar}.process(inputSample);`
          ].join("\n"),
          1
        ),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
};

export default allpassFilterNode;
