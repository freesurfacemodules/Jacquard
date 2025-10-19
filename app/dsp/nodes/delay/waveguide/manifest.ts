import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import waveguideDelaySource from "./waveguide-delay.as?raw";

const INPUT_PORT = "in";
const DELAY_INPUT_PORT = "delay";
const OUTPUT_PORT = "out";
const CONTROL_ID = "delay";

export const waveguideDelayNode: NodeImplementation = {
  manifest: {
    kind: "delay.waveguide",
    category: "delay",
    label: "Waveguide Delay",
    inputs: [
      audioPort(INPUT_PORT, "In"),
      audioPort(DELAY_INPUT_PORT, "Delay")
    ],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    defaultParams: {
      [CONTROL_ID]: 1
    },
    appearance: {
      width: 220,
      height: 160,
      icon: "wave-sine"
    },
    controls: [
      {
        id: CONTROL_ID,
        label: "Delay (samples)",
        type: "slider",
        min: 0.125,
        max: 4096
      }
    ]
  },
  assembly: {
    declarations: waveguideDelaySource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const delayInput = planNode.inputs.find((entry) => entry.port.id === DELAY_INPUT_PORT);
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const control = planNode.controls.find((entry) => entry.controlId === CONTROL_ID);

      if (!input || !output || !control) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const delayVar = `waveguide_${identifier}`;
      const inputExpr = helpers.buildInputExpression(input);
      const baseDelayExpr = helpers.parameterRef(control.index);

      const body: string[] = [];
      body.push(`let targetDelay: f32 = ${baseDelayExpr};`);
      body.push("if (targetDelay < WAVEGUIDE_MIN_DELAY_UI) targetDelay = WAVEGUIDE_MIN_DELAY_UI;");
      body.push("if (targetDelay > WAVEGUIDE_MAX_DELAY_UI) targetDelay = WAVEGUIDE_MAX_DELAY_UI;");

      if (delayInput && delayInput.wires.length > 0) {
        const delayExpr = helpers.buildInputExpression(delayInput);
        body.push(`let delayMod: f32 = ${delayExpr};`);
        body.push("if (delayMod < 0.0) delayMod = 0.0;");
        body.push("if (delayMod > 10.0) delayMod = 10.0;");
        body.push(
          "const normalized: f32 = delayMod * 0.1;"
        );
        body.push(
          "const modulatedDelay: f32 = WAVEGUIDE_MIN_DELAY_UI + normalized * (WAVEGUIDE_MAX_DELAY_UI - WAVEGUIDE_MIN_DELAY_UI);"
        );
        body.push("targetDelay = modulatedDelay;");
      }

      body.push(`const inputSample: f32 = ${inputExpr};`);
      body.push("let internalDelay: f32 = targetDelay * (<f32>OVERSAMPLING);");
      body.push(
        "if (internalDelay < WAVEGUIDE_MIN_INTERNAL_DELAY) internalDelay = WAVEGUIDE_MIN_INTERNAL_DELAY;"
      );
      body.push(
        "if (internalDelay > WAVEGUIDE_MAX_INTERNAL_DELAY) internalDelay = WAVEGUIDE_MAX_INTERNAL_DELAY;"
      );
      body.push(`${delayVar}.commit(inputSample, internalDelay);`);

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(body.join("\n"), 1),
        "}"
      ].join("\n");
    }
  }
};

export default waveguideDelayNode;
