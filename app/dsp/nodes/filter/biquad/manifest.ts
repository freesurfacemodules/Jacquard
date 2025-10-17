import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import biquadSource from "./biquad.as?raw";

const IN_PORT = "in";
const CUTOFF_PORT = "cutoff";
const RES_PORT = "resonance";
const LP_OUT = "low";
const HP_OUT = "high";

const CUTOFF_CONTROL = "cutoff";
const RES_CONTROL = "resonance";

export const biquadNode: NodeImplementation = {
  manifest: {
    kind: "filter.biquad",
    category: "filter",
    label: "Biquad",
    inputs: [
      audioPort(IN_PORT, "In"),
      audioPort(CUTOFF_PORT, "Cutoff"),
      audioPort(RES_PORT, "Resonance")
    ],
    outputs: [audioPort(LP_OUT, "Low"), audioPort(HP_OUT, "High")],
    defaultParams: {
      [CUTOFF_CONTROL]: 1000,
      [RES_CONTROL]: 0.707
    },
    appearance: {
      width: 220,
      height: 180,
      icon: "filter"
    },
    controls: [
      {
        id: CUTOFF_CONTROL,
        label: "Cutoff (Hz)",
        type: "slider",
        min: 20,
        max: 20000,
        step: 1
      },
      {
        id: RES_CONTROL,
        label: "Resonance",
        type: "slider",
        min: 0.1,
        max: 20,
        step: 0.01
      }
    ]
  },
  assembly: {
    declarations: biquadSource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === IN_PORT);
      const cutoffIn = planNode.inputs.find((entry) => entry.port.id === CUTOFF_PORT);
      const resIn = planNode.inputs.find((entry) => entry.port.id === RES_PORT);
      const lowOut = planNode.outputs.find((entry) => entry.port.id === LP_OUT);
      const highOut = planNode.outputs.find((entry) => entry.port.id === HP_OUT);
      const cutoffControl = planNode.controls.find((entry) => entry.controlId === CUTOFF_CONTROL);
      const resControl = planNode.controls.find((entry) => entry.controlId === RES_CONTROL);

      if (!lowOut || !highOut || !input || !cutoffControl || !resControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const stateVar = `biquad_${identifier}`;
      const inputExpr = helpers.buildInputExpression(input);
      const cutoffExpr = cutoffIn && cutoffIn.wires.length > 0
        ? helpers.buildInputExpression(cutoffIn)
        : helpers.parameterRef(cutoffControl.index);
      const resExpr = resIn && resIn.wires.length > 0
        ? helpers.buildInputExpression(resIn)
        : helpers.parameterRef(resControl.index);

      const lowAssignments = lowOut.wires.map((wire) => `${wire.varName} = lowSample;`).join("\n");
      const highAssignments = highOut.wires.map((wire) => `${wire.varName} = highSample;`).join("\n");

      const autoAssignments: string[] = [];
      if (helpers.autoRoute.left === planNode.node.id) {
        autoAssignments.push(`${helpers.autoLeftVar} = lowSample;`);
      }
      if (helpers.autoRoute.right === planNode.node.id) {
        autoAssignments.push(`${helpers.autoRightVar} = highSample;`);
      }

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const sampleIn: f32 = ${inputExpr};`, 1),
        helpers.indentLines(`let cutoffHz: f32 = ${cutoffExpr};`, 1),
        helpers.indentLines("if (cutoffHz < 20.0) cutoffHz = 20.0;", 1),
        helpers.indentLines("if (cutoffHz > 20000.0) cutoffHz = 20000.0;", 1),
        helpers.indentLines(`let resonance: f32 = ${resExpr};`, 1),
        helpers.indentLines("if (resonance < 0.1) resonance = 0.1;", 1),
        helpers.indentLines("if (resonance > 20.0) resonance = 20.0;", 1),
        helpers.indentLines(`${stateVar}.updateCoefficients(cutoffHz, resonance);`, 1),
        helpers.indentLines(`const lowSample: f32 = ${stateVar}.process(sampleIn);`, 1),
        helpers.indentLines("const highSample: f32 = sampleIn - lowSample;", 1),
        lowAssignments ? helpers.indentLines(lowAssignments, 1) : "",
        highAssignments ? helpers.indentLines(highAssignments, 1) : "",
        autoAssignments.length ? helpers.indentLines(autoAssignments.join("\n"), 1) : "",
        "}"
      ].filter(Boolean).join("\n");
    }
  }
};
