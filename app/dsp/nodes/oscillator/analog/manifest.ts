import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";
import analogOscSource from "./analog-osc.as?raw";

const OUTPUT_PORT = "out";
const PITCH_INPUT = "pitch";
const FM_INPUT = "fm";

const WAVEFORM_CONTROL = "waveform";
const TILT_CONTROL = "tilt";
const GUARD_CONTROL = "guard";
const BETA_CONTROL = "beta";
const FM_DEPTH_CONTROL = "fmDepth";

export const analogOscillatorNode: NodeImplementation = {
  manifest: {
    kind: "osc.analog",
    category: "oscillator",
    label: "Analog Oscillator",
    inputs: [
      audioPort(PITCH_INPUT, "Pitch (oct)"),
      audioPort(FM_INPUT, "FM (Hz)")
    ],
    outputs: [audioPort(OUTPUT_PORT, "Out")],
    defaultParams: {
      [PITCH_INPUT]: 0,
      [FM_INPUT]: 0,
      [WAVEFORM_CONTROL]: 0,
      [TILT_CONTROL]: 1,
      [GUARD_CONTROL]: 1200,
      [BETA_CONTROL]: 1.5,
      [FM_DEPTH_CONTROL]: 200
    },
    appearance: {
      width: 320,
      height: 200,
      icon: "wave-square"
    },
    controls: [
      {
        id: WAVEFORM_CONTROL,
        label: "Waveform",
        type: "select",
        options: [
          { value: 0, label: "Saw" },
          { value: 1, label: "Square" },
          { value: 2, label: "Triangle" }
        ]
      },
      {
        id: TILT_CONTROL,
        label: "Tilt (ρ)",
        type: "slider",
        min: 0,
        max: 3,
        step: 0.01
      },
      {
        id: GUARD_CONTROL,
        label: "Guard (Hz)",
        type: "slider",
        min: 0,
        max: 6000,
        step: 10
      },
      {
        id: BETA_CONTROL,
        label: "β",
        type: "slider",
        min: 0.5,
        max: 2,
        step: 0.05
      },
      {
        id: FM_DEPTH_CONTROL,
        label: "FM Depth (Hz/V)",
        type: "slider",
        min: 0,
        max: 4000,
        step: 10
      }
    ]
  },
  assembly: {
    declarations: analogOscSource,
    emit(planNode, helpers) {
      const output = planNode.outputs.find((entry) => entry.port.id === OUTPUT_PORT);
      const pitchInput = planNode.inputs.find((entry) => entry.port.id === PITCH_INPUT);
      const fmInput = planNode.inputs.find((entry) => entry.port.id === FM_INPUT);
      const waveformControl = planNode.controls.find((entry) => entry.controlId === WAVEFORM_CONTROL);
      const tiltControl = planNode.controls.find((entry) => entry.controlId === TILT_CONTROL);
      const guardControl = planNode.controls.find((entry) => entry.controlId === GUARD_CONTROL);
      const betaControl = planNode.controls.find((entry) => entry.controlId === BETA_CONTROL);
      const fmDepthControl = planNode.controls.find((entry) => entry.controlId === FM_DEPTH_CONTROL);

      if (
        !output ||
        !waveformControl ||
        !tiltControl ||
        !guardControl ||
        !betaControl ||
        !fmDepthControl
      ) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const oscillatorVar = `analog_${identifier}`;
      const pitchExpr = pitchInput
        ? helpers.buildInputExpression(pitchInput)
        : helpers.numberLiteral(0);
      const fmExpr = fmInput
        ? helpers.buildInputExpression(fmInput)
        : helpers.numberLiteral(0);

      const lines: string[] = [];
      lines.push(`// ${planNode.node.label} (${planNode.node.id})`);
      lines.push("{");

      lines.push(
        helpers.indentLines(
          [
            `let pitchValue: f32 = ${pitchExpr};`,
            "let baseFrequency: f32 = FREQ_C4 * Mathf.pow(2.0, pitchValue);",
            "if (baseFrequency < 0.0) baseFrequency = 0.0;",
            "const nyquistHz: f32 = SAMPLE_RATE * 0.49;",
            "if (baseFrequency > nyquistHz) baseFrequency = nyquistHz;",
            `let fmInputValue: f32 = ${fmExpr};`,
            `let fmDepth: f32 = ${helpers.parameterRef(fmDepthControl.index)};`,
            "if (fmDepth < 0.0) fmDepth = 0.0;",
            "let fmHz: f32 = fmInputValue * fmDepth;",
            "const phaseDelta: f32 = baseFrequency * INV_SAMPLE_RATE_OVERSAMPLED * TAU;",
            "const fmDelta: f32 = fmHz * INV_SAMPLE_RATE_OVERSAMPLED * TAU;",
            `let waveformParam: f32 = ${helpers.parameterRef(waveformControl.index)};`,
            "if (waveformParam < 0.0) waveformParam = 0.0;",
            "if (waveformParam > 2.0) waveformParam = 2.0;",
            "let waveformIndex: i32 = <i32>Mathf.round(waveformParam);",
            `let tiltValue: f32 = ${helpers.parameterRef(tiltControl.index)};`,
            `let guardValue: f32 = ${helpers.parameterRef(guardControl.index)};`,
            `let betaValue: f32 = ${helpers.parameterRef(betaControl.index)};`,
            `let sample: f32 = ${oscillatorVar}.step(phaseDelta, fmDelta, waveformIndex, tiltValue, guardValue, betaValue) * 5.0;`
          ].join("\n"),
          1
        )
      );

      const assignments = output.wires
        .map((wire) => `${wire.varName} = sample;`)
        .join("\n");
      if (assignments) {
        lines.push(helpers.indentLines(assignments, 1));
      }

      lines.push("}");

      return lines.join("\n");
    }
  }
};

export default analogOscillatorNode;
