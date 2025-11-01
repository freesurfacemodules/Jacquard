import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import complexResonatorSource from "./complex-resonator.as?raw";

const REAL_INPUT = "real";
const IMAG_INPUT = "imag";
const FREQ_INPUT = "frequency";
const DECAY_INPUT = "decay";

const REAL_OUTPUT = "real";
const IMAG_OUTPUT = "imag";
const MAG_OUTPUT = "magnitude";
const PHASE_OUTPUT = "phase";

const FREQ_CONTROL = "frequency";
const DECAY_CONTROL = "decay";

export const complexResonatorNode: NodeImplementation = {
  manifest: {
    kind: "resonator.complex",
    category: "resonator",
    label: "Complex Resonator",
    inputs: [
      audioPort(REAL_INPUT, "Real"),
      audioPort(IMAG_INPUT, "Imag"),
      audioPort(FREQ_INPUT, "Frequency"),
      audioPort(DECAY_INPUT, "Decay"),
    ],
    outputs: [
      audioPort(REAL_OUTPUT, "Real"),
      audioPort(IMAG_OUTPUT, "Imag"),
      audioPort(MAG_OUTPUT, "Magnitude"),
      audioPort(PHASE_OUTPUT, "Phase"),
    ],
    defaultParams: {
      [FREQ_CONTROL]: 261.6255653005986,
      [DECAY_CONTROL]: 0.5,
    },
    appearance: {
      width: 320,
      height: 200,
      icon: "wave-sine",
    },
    controls: [
      {
        id: FREQ_CONTROL,
        label: "Frequency (Hz)",
        type: "slider",
        min: 20,
        max: 20000,
      },
      {
        id: DECAY_CONTROL,
        label: "Decay",
        type: "slider",
        min: 0,
        max: 1,
      },
    ],
  },
  assembly: {
    declarations: complexResonatorSource,
    emit(planNode, helpers) {
      const realInput = planNode.inputs.find(
        (entry) => entry.port.id === REAL_INPUT,
      );
      const imagInput = planNode.inputs.find(
        (entry) => entry.port.id === IMAG_INPUT,
      );
      const freqInput = planNode.inputs.find(
        (entry) => entry.port.id === FREQ_INPUT,
      );
      const decayInput = planNode.inputs.find(
        (entry) => entry.port.id === DECAY_INPUT,
      );

      const realOutput = planNode.outputs.find(
        (entry) => entry.port.id === REAL_OUTPUT,
      );
      const imagOutput = planNode.outputs.find(
        (entry) => entry.port.id === IMAG_OUTPUT,
      );
      const magOutput = planNode.outputs.find(
        (entry) => entry.port.id === MAG_OUTPUT,
      );
      const phaseOutput = planNode.outputs.find(
        (entry) => entry.port.id === PHASE_OUTPUT,
      );

      const freqControl = planNode.controls.find(
        (entry) => entry.controlId === FREQ_CONTROL,
      );
      const decayControl = planNode.controls.find(
        (entry) => entry.controlId === DECAY_CONTROL,
      );

      if (
        !realOutput ||
        !imagOutput ||
        !magOutput ||
        !phaseOutput ||
        !freqControl ||
        !decayControl
      ) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const resonatorVar = `complexRes_${identifier}`;

      const realExpr = realInput
        ? helpers.buildInputExpression(realInput)
        : helpers.numberLiteral(0);
      const imagExpr = imagInput
        ? helpers.buildInputExpression(imagInput)
        : helpers.numberLiteral(0);
      const freqControlExpr = helpers.parameterRef(freqControl.index);
      const freqInputExpr =
        freqInput && freqInput.wires.length > 0
          ? helpers.buildInputExpression(freqInput)
          : null;
      const decayControlExpr = helpers.parameterRef(decayControl.index);
      const decayInputExpr =
        decayInput && decayInput.wires.length > 0
          ? helpers.buildInputExpression(decayInput)
          : null;

      const realAssignments = realOutput.wires
        .map((wire) => `${wire.varName} = outputReal;`)
        .join("\n");
      const imagAssignments = imagOutput.wires
        .map((wire) => `${wire.varName} = outputImag;`)
        .join("\n");
      const magAssignments = magOutput.wires
        .map((wire) => `${wire.varName} = outputMag;`)
        .join("\n");
      const phaseAssignments = phaseOutput.wires
        .map((wire) => `${wire.varName} = outputPhase;`)
        .join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `let baseFreqHz: f32 = ${freqControlExpr};`,
            "if (baseFreqHz < 20.0) baseFreqHz = 20.0;",
            "const freqMax: f32 = SAMPLE_RATE * 0.45;",
            "if (baseFreqHz > freqMax) baseFreqHz = freqMax;",
            "let pitchValue: f32 = pitchFromHz(baseFreqHz);",
            ...(freqInputExpr ? [`pitchValue += ${freqInputExpr};`] : []),
            `let decayNormalized: f32 = ${decayControlExpr};`,
            "if (decayNormalized < 0.0) decayNormalized = 0.0;",
            "if (decayNormalized > 1.0) decayNormalized = 1.0;",
            ...(decayInputExpr
              ? [
                  `let decayCv: f32 = ${decayInputExpr};`,
                  "let decayFromCv: f32 = decayCv * 0.1;",
                  "if (decayFromCv < 0.0) decayFromCv = 0.0;",
                  "if (decayFromCv > 1.0) decayFromCv = 1.0;",
                  "decayNormalized = decayFromCv;",
                ]
              : []),
            `${resonatorVar}.setTuning(pitchValue, decayNormalized);`,
            `const realIn: f32 = ${realExpr};`,
            `const imagIn: f32 = ${imagExpr};`,
            `const outputVec = ${resonatorVar}.process(realIn, imagIn);`,
            "const outputReal: f32 = f32x4.extract_lane(outputVec, 0);",
            "const outputImag: f32 = f32x4.extract_lane(outputVec, 1);",
            "const outputMag: f32 = f32x4.extract_lane(outputVec, 2);",
            "const outputPhase: f32 = f32x4.extract_lane(outputVec, 3);",
          ].join("\n"),
          1,
        ),
        realAssignments ? helpers.indentLines(realAssignments, 1) : "",
        imagAssignments ? helpers.indentLines(imagAssignments, 1) : "",
        magAssignments ? helpers.indentLines(magAssignments, 1) : "",
        phaseAssignments ? helpers.indentLines(phaseAssignments, 1) : "",
        "}",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
};

export default complexResonatorNode;
