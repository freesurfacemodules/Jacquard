import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import ddlDelaySource from "./ddl.as?raw";

const CONTROL_ID = "delay";

export const ddlDelayNode: NodeImplementation = {
  manifest: {
    kind: "delay.ddl",
    category: "delay",
    label: "DDL Delay",
    inputs: [audioPort("in", "In")],
    outputs: [audioPort("out", "Out")],
    defaultParams: {
      [CONTROL_ID]: 1
    },
    appearance: {
      width: 200,
      height: 140,
      icon: "clock"
    },
    controls: [
      {
        id: CONTROL_ID,
        label: "Delay (samples)",
        type: "slider",
        min: 0.125,
        max: 4096,
        step: 0.125
      }
    ]
  },
  assembly: {
    declarations: ddlDelaySource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === "in");
      const control = planNode.controls.find((entry) => entry.controlId === CONTROL_ID);

      if (!input || !control) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const inputExpr = helpers.buildInputExpression(input);
      const parameterRef = helpers.parameterRef(control.index);
      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const delayVar = `delay_${identifier}`;

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `const rawDelay: f32 = Mathf.max(MIN_DELAY_SAMPLES, ${parameterRef});`,
            "const clampedDelay: f32 = Mathf.min(rawDelay, 4096.0);",
            "let internalSamples: i32 = Mathf.round(clampedDelay * (<f32>OVERSAMPLING)) as i32;",
            "if (internalSamples < 1) internalSamples = 1;",
            "if (internalSamples > MAX_DELAY_SAMPLES) internalSamples = MAX_DELAY_SAMPLES;",
            `const inputSample: f32 = ${inputExpr};`,
            `${delayVar}.commit(inputSample, internalSamples);`
          ].join("\n"),
          1
        ),
        "}"
      ].join("\n");
    }
  }
};
