import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import counterSource from "./counter.as?raw";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const INPUT_INCREMENT = "increment";
const INPUT_RESET = "reset";
const OUTPUT_COUNT = "count";
const OUTPUT_MAX = "max";
const CONTROL_MAX = "maxValue";

export const counterNode: NodeImplementation = {
  manifest: {
    kind: "logic.counter",
    category: "logic",
    label: "Counter",
    inputs: [
      audioPort(INPUT_INCREMENT, "Increment"),
      audioPort(INPUT_RESET, "Reset")
    ],
    outputs: [audioPort(OUTPUT_COUNT, "Count"), audioPort(OUTPUT_MAX, "Max")],
    defaultParams: {
      [CONTROL_MAX]: 8
    },
    appearance: {
      width: 220,
      height: 180,
      icon: "hash"
    },
    controls: [
      {
        id: CONTROL_MAX,
        label: "Max Count",
        type: "slider",
        min: 1,
        max: 128,
        step: 1
      }
    ]
  },
  assembly: {
    declarations: [schmittTriggerSource, counterSource],
    emit(planNode, helpers) {
      const incrementInput = planNode.inputs.find((entry) => entry.port.id === INPUT_INCREMENT);
      const resetInput = planNode.inputs.find((entry) => entry.port.id === INPUT_RESET);
      const countOutput = planNode.outputs.find((entry) => entry.port.id === OUTPUT_COUNT);
      const maxOutput = planNode.outputs.find((entry) => entry.port.id === OUTPUT_MAX);
      const maxControl = planNode.controls.find((entry) => entry.controlId === CONTROL_MAX);

      if (!incrementInput || !resetInput || !countOutput || !maxOutput || !maxControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const counterVar = `counter_${identifier}`;
      const incrementExpr = helpers.buildInputExpression(incrementInput);
      const resetExpr = helpers.buildInputExpression(resetInput);
      const maxParamExpr = helpers.parameterRef(maxControl.index);

      const countAssignments = countOutput.wires
        .map((wire) => `${wire.varName} = counterResult.value;`)
        .join("\n");
      const maxAssignments = maxOutput.wires
        .map((wire) => `${wire.varName} = counterResult.maxSignal;`)
        .join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const incrementSample: f32 = ${incrementExpr};`, 1),
        helpers.indentLines(`const resetSample: f32 = ${resetExpr};`, 1),
        helpers.indentLines(`let maxSetting: f32 = ${maxParamExpr};`, 1),
        helpers.indentLines("if (maxSetting < 1.0) maxSetting = 1.0;", 1),
        helpers.indentLines("if (maxSetting > 128.0) maxSetting = 128.0;", 1),
        helpers.indentLines(`${counterVar}.setMaxValue(maxSetting);`, 1),
        helpers.indentLines(`const counterResult = ${counterVar}.step(incrementSample, resetSample);`, 1),
        countAssignments ? helpers.indentLines(countAssignments, 1) : "",
        maxAssignments ? helpers.indentLines(maxAssignments, 1) : "",
        "}"
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
};

export default counterNode;
