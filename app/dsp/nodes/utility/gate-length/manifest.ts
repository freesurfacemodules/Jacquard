import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const TRIGGER_INPUT = "trigger";
const OUTPUT_PORT = "out";
const TIME_CONTROL = "time";

const MIN_TIME = 0.001;
const MAX_TIME = 1.0;
const ACTIVE_LEVEL = 10.0;

export const gateLengthNode: NodeImplementation = {
  manifest: {
    kind: "utility.gatelength",
    category: "utility",
    label: "Gate Length",
    inputs: [audioPort(TRIGGER_INPUT, "Trigger")],
    outputs: [audioPort(OUTPUT_PORT, "Gate")],
    defaultParams: {
      [TIME_CONTROL]: 0.1
    },
    appearance: {
      width: 200,
      height: 160,
      icon: "clock"
    },
    controls: [
      {
        id: TIME_CONTROL,
        label: "Gate Time (s)",
        type: "slider",
        min: MIN_TIME,
        max: MAX_TIME
      }
    ]
  },
  assembly: {
    declarations: schmittTriggerSource,
    emit(planNode, helpers) {
      const triggerInput = planNode.inputs.find((entry) => entry.port.id === TRIGGER_INPUT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const timeControl = planNode.controls.find((entry) => entry.controlId === TIME_CONTROL);

      if (!triggerInput || !output || !timeControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const triggerVar = `gate_trig_${identifier}`;
      const activeVar = `gate_active_${identifier}`;
      const counterVar = `gate_counter_${identifier}`;

      const triggerExpr = helpers.buildInputExpression(triggerInput);
      const timeExpr = helpers.parameterRef(timeControl.index);
      const assignments = output.wires.map((wire) => `${wire.varName} = gateOutput;`).join("\n");

      const bodyLines: string[] = [];
      bodyLines.push(`let gateTime: f32 = ${timeExpr};`);
      bodyLines.push(`if (gateTime < ${MIN_TIME}) gateTime = ${MIN_TIME};`);
      bodyLines.push(`if (gateTime > ${MAX_TIME}) gateTime = ${MAX_TIME};`);
      bodyLines.push("let gateSamples: i32 = Mathf.round(gateTime * SAMPLE_RATE * (<f32>OVERSAMPLING));");
      bodyLines.push("if (gateSamples < 1) gateSamples = 1;");
      bodyLines.push(`const triggerSample: f32 = ${triggerExpr};`);
      bodyLines.push(`if (${triggerVar}.process(triggerSample)) {`);
      bodyLines.push(`  ${activeVar} = true;`);
      bodyLines.push(`  ${counterVar} = gateSamples;`);
      bodyLines.push("}");
      bodyLines.push("let gateOutput: f32 = 0.0;");
      bodyLines.push(`if (${activeVar}) {`);
      bodyLines.push(`  gateOutput = ${ACTIVE_LEVEL};`);
      bodyLines.push(`  ${counterVar} -= 1;`);
      bodyLines.push(`  if (${counterVar} <= 0) {`);
      bodyLines.push(`    ${activeVar} = false;`);
      bodyLines.push(`    ${counterVar} = 0;`);
      bodyLines.push("  }");
      bodyLines.push("}");

      const indentLevel = helpers.usesOversampling ? 2 : 1;
      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(bodyLines.join("\n"), indentLevel),
        assignments ? helpers.indentLines(assignments, indentLevel) : "",
        "}"
      ]
        .filter((section) => section.length > 0)
        .join("\n");
    }
  }
};

export default gateLengthNode;
