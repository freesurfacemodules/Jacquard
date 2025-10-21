import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_SIGNAL = "signal";
const INPUT_TRIGGER = "trigger";
const OUTPUT_PORT = "out";

export const sampleHoldNode: NodeImplementation = {
  manifest: {
    kind: "utility.samplehold",
    category: "utility",
    label: "Sample & Hold",
    inputs: [
      audioPort(INPUT_SIGNAL, "Signal"),
      audioPort(INPUT_TRIGGER, "Trigger")
    ],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    appearance: {
      width: 220,
      height: 160,
      icon: "wave-square"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const signalInput = planNode.inputs.find((entry) => entry.port.id === INPUT_SIGNAL);
      const triggerInput = planNode.inputs.find((entry) => entry.port.id === INPUT_TRIGGER);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);

      if (!signalInput || !triggerInput || !output) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const triggerVar = `snh_trig_${identifier}`;
      const stateVar = `snh_state_${identifier}`;
      const signalExpr = helpers.buildInputExpression(signalInput);
      const triggerExpr = helpers.buildInputExpression(triggerInput);
      const assignments = output.wires.map((wire) => `${wire.varName} = snhValue;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const trigSample: f32 = ${triggerExpr};`, 1),
        helpers.indentLines(`const isTrigger: bool = ${triggerVar}.process(trigSample);`, 1),
        helpers.indentLines(`if (isTrigger) { ${stateVar} = ${signalExpr}; }`, 1),
        helpers.indentLines(`const snhValue: f32 = ${stateVar};`, 1),
        assignments ? helpers.indentLines(assignments, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

export default sampleHoldNode;
