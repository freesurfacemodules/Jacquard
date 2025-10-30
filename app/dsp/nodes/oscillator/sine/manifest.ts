import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import type { PlanInput } from "@codegen/plan";
import sineOscDeclarations from "./sine.as?raw";

const CHANNEL_OUT = "out";
const PITCH_INPUT = "pitch";

const sineManifest: NodeImplementation = {
  manifest: {
    kind: "osc.sine",
    category: "oscillator",
    label: "Sine Oscillator",
    inputs: [audioPort(PITCH_INPUT, "Pitch (oct)")],
    outputs: [audioPort(CHANNEL_OUT, "Out")],
    defaultParams: {
      pitch: 0
    },
    appearance: {
      width: 260,
      height: 120,
      icon: "wave-sine"
    }
  },
  assembly: {
    declarations: sineOscDeclarations,
    emit(planNode, helpers) {
      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const output = planNode.outputs.find((port) => port.port.id === CHANNEL_OUT);

      if (!output || output.wires.length === 0) {
        return `// ${planNode.node.label} (${planNode.node.id}) has no outgoing connections.`;
      }

      const pitchInput = findInput(planNode.inputs, PITCH_INPUT);
      const pitchExpr = pitchInput
        ? helpers.buildInputExpression(pitchInput)
        : helpers.numberLiteral(0);

      const assignments = output.wires
        .map((wire) => `${wire.varName} = sample;`)
        .join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`let pitch: f32 = ${pitchExpr};`, 1),
        helpers.indentLines(
          "let frequency: f32 = FREQ_C4 * fastExp2(pitch);",
          1
        ),
        helpers.indentLines(`let sample: f32 = node_${identifier}.step(frequency) * 5.0;`, 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

function findInput(inputs: PlanInput[], id: string): PlanInput | undefined {
  return inputs.find((input) => input.port.id === id);
}

export const sineOscNode = sineManifest;
