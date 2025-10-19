import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import slewLimiterSource from "./slew-limiter.as?raw";

const INPUT_PORT = "in";
const OUTPUT_PORT = "out";
const RISE_CONTROL = "rise";
const FALL_CONTROL = "fall";
const SHAPE_CONTROL = "shape";

export const slewLimiterNode: NodeImplementation = {
  manifest: {
    kind: "utility.slew",
    category: "filter",
    label: "Slew Limiter",
    inputs: [audioPort(INPUT_PORT, "In")],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    defaultParams: {
      [RISE_CONTROL]: 0.01,
      [FALL_CONTROL]: 0.05,
      [SHAPE_CONTROL]: 0.5
    },
    appearance: {
      width: 220,
      height: 160,
      icon: "wave-triangle"
    },
    controls: [
      {
        id: RISE_CONTROL,
        label: "Rise (s)",
        type: "slider",
        min: 0.0001,
        max: 2,
        step: 0.0001
      },
      {
        id: FALL_CONTROL,
        label: "Fall (s)",
        type: "slider",
        min: 0.0001,
        max: 2,
        step: 0.0001
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
    declarations: slewLimiterSource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const riseControl = planNode.controls.find((entry) => entry.controlId === RISE_CONTROL);
      const fallControl = planNode.controls.find((entry) => entry.controlId === FALL_CONTROL);
      const shapeControl = planNode.controls.find((entry) => entry.controlId === SHAPE_CONTROL);

      if (!output || !riseControl || !fallControl || !shapeControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const slewVar = `slew_${identifier}`;
      const inputExpr = input
        ? helpers.buildInputExpression(input)
        : helpers.numberLiteral(0);
      const riseExpr = helpers.parameterRef(riseControl.index);
      const fallExpr = helpers.parameterRef(fallControl.index);
      const shapeExpr = helpers.parameterRef(shapeControl.index);

      const assignments = output.wires
        .map((wire) => `${wire.varName} = slewed;`)
        .join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `let inputSample: f32 = ${inputExpr};`,
            `let riseSeconds: f32 = ${riseExpr};`,
            `let fallSeconds: f32 = ${fallExpr};`,
            `let shape: f32 = ${shapeExpr};`,
            "if (riseSeconds < 0.0001) riseSeconds = 0.0001;",
            "if (fallSeconds < 0.0001) fallSeconds = 0.0001;",
            "if (shape < 0.0) shape = 0.0;",
            "if (shape > 1.0) shape = 1.0;",
            `const slewed: f32 = ${slewVar}.step(inputSample, riseSeconds, fallSeconds, shape);`
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
