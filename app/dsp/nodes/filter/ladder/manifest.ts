import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import ladderFilterSource from "./ladder.as?raw";

const INPUT_PORT = "in";
const FREQ_PORT = "frequency";
const RES_PORT = "resonance";
const DRIVE_PORT = "drive";
const LPF_OUT = "lowpass";
const HPF_OUT = "highpass";

const FREQ_CONTROL = "frequency";
const RES_CONTROL = "resonance";
const DRIVE_CONTROL = "drive";

export const ladderFilterNode: NodeImplementation = {
  manifest: {
    kind: "filter.ladder",
    category: "filter",
    label: "Ladder Filter",
    inputs: [
      audioPort(INPUT_PORT, "In"),
      audioPort(FREQ_PORT, "Frequency"),
      audioPort(RES_PORT, "Resonance"),
      audioPort(DRIVE_PORT, "Drive")
    ],
    outputs: [audioPort(LPF_OUT, "Lowpass"), audioPort(HPF_OUT, "Highpass")],
    defaultParams: {
      [FREQ_CONTROL]: 1000,
      [RES_CONTROL]: 0.2,
      [DRIVE_CONTROL]: 0
    },
    appearance: {
      width: 260,
      height: 180,
      icon: "filter"
    },
    controls: [
      {
        id: FREQ_CONTROL,
        label: "Cutoff (Hz)",
        type: "slider",
        min: 20,
        max: 20000
      },
      {
        id: RES_CONTROL,
        label: "Resonance",
        type: "slider",
        min: 0,
        max: 1
      },
      {
        id: DRIVE_CONTROL,
        label: "Drive",
        type: "slider",
        min: -1,
        max: 1
      }
    ]
  },
  assembly: {
    declarations: ladderFilterSource,
    emit(planNode, helpers) {
      const input = planNode.inputs.find((entry) => entry.port.id === INPUT_PORT);
      const freqInput = planNode.inputs.find((entry) => entry.port.id === FREQ_PORT);
      const resInput = planNode.inputs.find((entry) => entry.port.id === RES_PORT);
      const driveInput = planNode.inputs.find((entry) => entry.port.id === DRIVE_PORT);
      const lowOut = planNode.outputs.find((entry) => entry.port.id === LPF_OUT);
      const highOut = planNode.outputs.find((entry) => entry.port.id === HPF_OUT);
      const freqControl = planNode.controls.find((entry) => entry.controlId === FREQ_CONTROL);
      const resControl = planNode.controls.find((entry) => entry.controlId === RES_CONTROL);
      const driveControl = planNode.controls.find((entry) => entry.controlId === DRIVE_CONTROL);

      if (!lowOut || !highOut || !freqControl || !resControl || !driveControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const filterVar = `ladder_${identifier}`;
      const rngVar = `ladder_rng_${identifier}`;

      const inputExpr = input
        ? helpers.buildInputExpression(input)
        : helpers.numberLiteral(0);
      const baseCutoffExpr = helpers.parameterRef(freqControl.index);
      const pitchExpr = freqInput && freqInput.wires.length > 0
        ? helpers.buildInputExpression(freqInput)
        : helpers.numberLiteral(0);
      const resExpr = resInput && resInput.wires.length > 0
        ? helpers.buildInputExpression(resInput)
        : helpers.parameterRef(resControl.index);
      const driveExpr = driveInput && driveInput.wires.length > 0
        ? helpers.buildInputExpression(driveInput)
        : helpers.parameterRef(driveControl.index);

      const lowAssignments = lowOut.wires
        .map((wire) => `${wire.varName} = lowpassSample;`)
        .join("\n");
      const highAssignments = highOut.wires
        .map((wire) => `${wire.varName} = highpassSample;`)
        .join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `let inputSample: f32 = ${inputExpr};`,
            `let cutoffHz: f32 = ${baseCutoffExpr};`,
            "if (cutoffHz < 20.0) cutoffHz = 20.0;",
            "const maxCutoff: f32 = SAMPLE_RATE * 0.45;",
            "if (cutoffHz > maxCutoff) cutoffHz = maxCutoff;",
            `let pitchOffset: f32 = ${pitchExpr};`,
            "if (pitchOffset < -10.0) pitchOffset = -10.0;",
            "if (pitchOffset > 10.0) pitchOffset = 10.0;",
            "cutoffHz *= Mathf.pow(2.0, pitchOffset);",
            "if (cutoffHz < 20.0) cutoffHz = 20.0;",
            "if (cutoffHz > maxCutoff) cutoffHz = maxCutoff;",
            `${filterVar}.setCutoff(cutoffHz);`,
            `let resonanceParam: f32 = ${resExpr};`,
            "if (resonanceParam < 0.0) resonanceParam = 0.0;",
            "if (resonanceParam > 1.0) resonanceParam = 1.0;",
            "const ladderResonance: f32 = Mathf.pow(resonanceParam, 2.0) * 10.0;",
            `${filterVar}.setResonance(ladderResonance);`,
            `let driveParam: f32 = ${driveExpr};`,
            "if (driveParam < -1.0) driveParam = -1.0;",
            "if (driveParam > 1.0) driveParam = 1.0;",
            "const driveGain: f32 = Mathf.pow(1.0 + driveParam, 5.0);",
            "inputSample *= driveGain;",
            `inputSample += 1e-6 * (((${rngVar}.uniform()) * 2.0) - 1.0);`,
            `${filterVar}.process(inputSample);`,
            `const lowpassSample: f32 = ${filterVar}.lowpass();`,
            `const highpassSample: f32 = ${filterVar}.highpass();`
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
