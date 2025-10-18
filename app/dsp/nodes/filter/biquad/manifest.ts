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
      const lowVar = `biquad_low_${identifier}`;
      const highVar = `biquad_high_${identifier}`;
      const inputExpr = helpers.buildInputExpression(input);
      const baseCutoffExpr = helpers.parameterRef(cutoffControl.index);
      const pitchExpr = cutoffIn && cutoffIn.wires.length > 0
        ? helpers.buildInputExpression(cutoffIn)
        : helpers.numberLiteral(0);
      const resExpr = resIn && resIn.wires.length > 0
        ? helpers.buildInputExpression(resIn)
        : helpers.parameterRef(resControl.index);

      const lowAssignments = lowOut.wires.map((wire) => `${wire.varName} = lowSample;`).join("\n");
      const highAssignments = highOut.wires.map((wire) => `${wire.varName} = highSample;`).join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const sampleIn: f32 = ${inputExpr};`, 1),
        helpers.indentLines(`let cutoffHz: f32 = ${baseCutoffExpr};`, 1),
        helpers.indentLines("if (cutoffHz < 20.0) cutoffHz = 20.0;", 1),
        helpers.indentLines("const maxCutoff: f32 = SAMPLE_RATE * 0.45;", 1),
        helpers.indentLines("if (cutoffHz > maxCutoff) cutoffHz = maxCutoff;", 1),
        helpers.indentLines(`let pitchOffset: f32 = ${pitchExpr};`, 1),
        helpers.indentLines("if (pitchOffset < -10.0) pitchOffset = -10.0;", 1),
        helpers.indentLines("if (pitchOffset > 10.0) pitchOffset = 10.0;", 1),
        helpers.indentLines("cutoffHz *= Mathf.pow(2.0, pitchOffset);", 1),
        helpers.indentLines("if (cutoffHz < 20.0) cutoffHz = 20.0;", 1),
        helpers.indentLines("if (cutoffHz > maxCutoff) cutoffHz = maxCutoff;", 1),
        helpers.indentLines(`let resonance: f32 = ${resExpr};`, 1),
        helpers.indentLines("if (resonance < 0.1) resonance = 0.1;", 1),
        helpers.indentLines("if (resonance > 20.0) resonance = 20.0;", 1),
        helpers.indentLines(
          [
            "let normalized: f32 = cutoffHz / (SAMPLE_RATE * (<f32>OVERSAMPLING));",
            "if (normalized < 0.0001) normalized = 0.0001;",
            "if (normalized > 0.49) normalized = 0.49;",
            "const sinPiF: f32 = Mathf.sin(Mathf.PI * normalized);",
            "const cosPiF: f32 = Mathf.cos(Mathf.PI * normalized);",
            "let K: f32 = sinPiF / cosPiF;",
            "if (!isFinite<f32>(K)) { K = 1.0; }",
            "const norm: f32 = 1.0 / (1.0 + K / resonance + K * K);",
            "const a1: f32 = 2.0 * (K * K - 1.0) * norm;",
            "const a2: f32 = (1.0 - K / resonance + K * K) * norm;",
            "const lp_b0: f32 = K * K * norm;",
            "const lp_b1: f32 = 2.0 * lp_b0;",
            "const lp_b2: f32 = lp_b0;",
            "const hp_b0: f32 = norm;",
            "const hp_b1: f32 = -2.0 * norm;",
            "const hp_b2: f32 = norm;",
            `${lowVar}.updateCoefficients(lp_b0, lp_b1, lp_b2, a1, a2);`,
            `${highVar}.updateCoefficients(hp_b0, hp_b1, hp_b2, a1, a2);`,
            `const lowSample: f32 = ${lowVar}.process(sampleIn);`,
            `const highSample: f32 = ${highVar}.process(sampleIn);`
          ].join("\n"),
          1
        ),
        lowAssignments ? helpers.indentLines(lowAssignments, 1) : "",
        highAssignments ? helpers.indentLines(highAssignments, 1) : "",
        "}"
      ].filter(Boolean).join("\n");
    }
  }
};
