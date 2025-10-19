import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import adEnvelopeSource from "./ad-envelope.as?raw";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const TRIGGER_INPUT = "trigger";
const OUTPUT_PORT = "envelope";

const RISE_CONTROL = "rise";
const FALL_CONTROL = "fall";
const SHAPE_CONTROL = "shape";

export const adEnvelopeNode: NodeImplementation = {
  manifest: {
    kind: "envelope.ad",
    category: "envelope",
    label: "AD Envelope",
    inputs: [audioPort(TRIGGER_INPUT, "Trigger")],
    outputs: [audioPort(OUTPUT_PORT, "Envelope")],
    defaultParams: {
      [RISE_CONTROL]: 0.05,
      [FALL_CONTROL]: 0.25,
      [SHAPE_CONTROL]: 0.5
    },
    appearance: {
      width: 240,
      height: 200,
      icon: "wave-square"
    },
    controls: [
      {
        id: RISE_CONTROL,
        label: "Rise (s)",
        type: "slider",
        min: 0.001,
        max: 5,
        step: 0.001
      },
      {
        id: FALL_CONTROL,
        label: "Fall (s)",
        type: "slider",
        min: 0.001,
        max: 5,
        step: 0.001
      },
      {
        id: SHAPE_CONTROL,
        label: "Curve",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01
      }
    ]
  },
  assembly: {
    declarations: [schmittTriggerSource, adEnvelopeSource],
    emit(planNode, helpers) {
      const triggerInput = planNode.inputs.find((entry) => entry.port.id === TRIGGER_INPUT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const riseControl = planNode.controls.find((entry) => entry.controlId === RISE_CONTROL);
      const fallControl = planNode.controls.find((entry) => entry.controlId === FALL_CONTROL);
      const shapeControl = planNode.controls.find((entry) => entry.controlId === SHAPE_CONTROL);

      if (!output || !riseControl || !fallControl || !shapeControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const schmittVar = `schmitt_${identifier}`;
      const envelopeVar = `env_${identifier}`;
      const monitorIndex =
        typeof planNode.envelopeMonitorIndex === "number"
          ? planNode.envelopeMonitorIndex
          : -1;

      const triggerExpr = triggerInput
        ? helpers.buildInputExpression(triggerInput)
        : helpers.numberLiteral(0);
      const riseExpr = helpers.parameterRef(riseControl.index);
      const fallExpr = helpers.parameterRef(fallControl.index);
      const shapeExpr = helpers.parameterRef(shapeControl.index);

      const outputAssignments = output.wires
        .map((wire) => `${wire.varName} = envelopeValue;`)
        .join("\n");

      const monitorLines =
        monitorIndex >= 0
          ? [
              `setEnvelopeMonitor(${monitorIndex}, envelopeValue, ${envelopeVar}.getProgress());`
            ]
          : [];

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `const triggerSample: f32 = ${triggerExpr};`,
            `const riseTime: f32 = ${riseExpr};`,
            `const fallTime: f32 = ${fallExpr};`,
            `const shapeAmount: f32 = ${shapeExpr};`,
            `if (${schmittVar}.process(triggerSample)) {`,
            `  ${envelopeVar}.start(riseTime, fallTime, shapeAmount);`,
            `}`,
            `const envelopeValue: f32 = ${envelopeVar}.step();`,
            ...monitorLines
          ].join("\n"),
          1
        ),
        outputAssignments ? helpers.indentLines(outputAssignments, 1) : "",
        "}"
      ].filter(Boolean);

      return lines.join("\n");
    }
  }
};
