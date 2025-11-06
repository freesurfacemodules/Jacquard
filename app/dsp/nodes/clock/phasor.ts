import { audioPort } from "../common";
import type { NodeImplementation } from "@dsp/types";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const BPM_CONTROL = "bpm";
const MULT_CONTROL = "mult";
const DIV_CONTROL = "div";
const RESET_INPUT = "reset";
const BPM_INPUT = "bpmIn";
const CLOCK_OUTPUT = "out";
const BPM_OUTPUT = "bpmOut";

const CLOCK_MIN_BPM = 0.1171875;
const CLOCK_MAX_BPM = 122880.0;
const PHASOR_MAX = 10.0;

export const phasorClockNode: NodeImplementation = {
  manifest: {
    kind: "clock.phasor",
    category: "clock",
    label: "Phasor Clock",
    inputs: [audioPort(RESET_INPUT, "Reset"), audioPort(BPM_INPUT, "BPM CV")],
    outputs: [audioPort(CLOCK_OUTPUT, "Out"), audioPort(BPM_OUTPUT, "BPM CV")],
    defaultParams: {
      [BPM_CONTROL]: 120,
      [MULT_CONTROL]: 1,
      [DIV_CONTROL]: 1
    },
    appearance: {
      width: 220,
      height: 160,
      icon: "wave-square"
    },
    controls: [
      {
        id: BPM_CONTROL,
        label: "BPM",
        type: "slider",
        min: 30,
        max: 300
      },
      {
        id: MULT_CONTROL,
        label: "Multiply",
        type: "slider",
        min: 1,
        max: 32,
        step: 1
      },
      {
        id: DIV_CONTROL,
        label: "Divide",
        type: "slider",
        min: 1,
        max: 32,
        step: 1
      }
    ]
  },
  assembly: {
    declarations: schmittTriggerSource,
    emit(planNode, helpers) {
      const phasorOutput = planNode.outputs.find((entry) => entry.port.id === CLOCK_OUTPUT);
      const bpmOutput = planNode.outputs.find((entry) => entry.port.id === BPM_OUTPUT);
      const resetInput = planNode.inputs.find((entry) => entry.port.id === RESET_INPUT);
      const bpmInput = planNode.inputs.find((entry) => entry.port.id === BPM_INPUT);
      const bpmControl = planNode.controls.find((entry) => entry.controlId === BPM_CONTROL);
      const multControl = planNode.controls.find((entry) => entry.controlId === MULT_CONTROL);
      const divControl = planNode.controls.find((entry) => entry.controlId === DIV_CONTROL);

      if (!phasorOutput || !bpmOutput || !bpmControl || !multControl || !divControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const phaseVar = `phasor_phase_${identifier}`;
      const resetVar = `phasor_reset_${identifier}`;
      const bpmCvVar = `phasor_bpmCv_${identifier}`;
      const phasorAssignments = phasorOutput.wires
        .map((wire) => `${wire.varName} = phasorSample;`)
        .join("\n");
      const bpmAssignments = bpmOutput.wires
        .map((wire) => `${wire.varName} = ${bpmCvVar};`)
        .join("\n");

      const bpmInputExpr =
        bpmInput && bpmInput.wires.length > 0 ? helpers.buildInputExpression(bpmInput) : null;
      const resetExpr =
        resetInput && resetInput.wires.length > 0 ? helpers.buildInputExpression(resetInput) : null;

      const lines: string[] = [];
      lines.push(`// ${planNode.node.label} (${planNode.node.id})`);
      lines.push("{");

      const body: string[] = [];
      body.push(`let bpmValue: f32 = ${helpers.parameterRef(bpmControl.index)};`);
      body.push(`if (bpmValue < ${CLOCK_MIN_BPM}) bpmValue = ${CLOCK_MIN_BPM};`);
      body.push(`if (bpmValue > ${CLOCK_MAX_BPM}) bpmValue = ${CLOCK_MAX_BPM};`);

      if (bpmInputExpr) {
        const bpmInputVar = `phasor_bpmInput_${identifier}`;
        body.push(`let ${bpmInputVar}: f32 = ${bpmInputExpr};`);
        body.push(`if (${bpmInputVar} < -10.0) ${bpmInputVar} = -10.0;`);
        body.push(`if (${bpmInputVar} > 10.0) ${bpmInputVar} = 10.0;`);
        body.push(`bpmValue = 120.0 * fastExp2(${bpmInputVar});`);
        body.push(`if (bpmValue < ${CLOCK_MIN_BPM}) bpmValue = ${CLOCK_MIN_BPM};`);
        body.push(`if (bpmValue > ${CLOCK_MAX_BPM}) bpmValue = ${CLOCK_MAX_BPM};`);
      }

      body.push(`let multiplier: f32 = Mathf.round(${helpers.parameterRef(multControl.index)});`);
      body.push("if (multiplier < 1.0) multiplier = 1.0;");
      body.push("if (multiplier > 32.0) multiplier = 32.0;");

      body.push(`let division: f32 = Mathf.round(${helpers.parameterRef(divControl.index)});`);
      body.push("if (division < 1.0) division = 1.0;");
      body.push("if (division > 32.0) division = 32.0;");

      const resetFlag = `phasor_resetTriggered_${identifier}`;
      if (resetExpr) {
        body.push(`let ${resetFlag}: bool = false;`);
        body.push(`const resetSignal: f32 = ${resetExpr};`);
        body.push(`if (${resetVar}.process(resetSignal)) {`);
        body.push(`  ${phaseVar} = 0.0;`);
        body.push(`  ${resetFlag} = true;`);
        body.push("}");
      } else {
        body.push(`let ${resetFlag}: bool = false;`);
      }

      body.push("const beatsPerSecond: f32 = bpmValue / 60.0;");
      body.push("const frequency: f32 = beatsPerSecond * multiplier / division;");
      body.push("const phaseDelta: f32 = frequency * INV_SAMPLE_RATE_OVERSAMPLED;");

      body.push("let phasorSample: f32 = 0.0;");
      body.push(`if (!${resetFlag}) {`);
      body.push(`  ${phaseVar} += phaseDelta;`);
      body.push(`  if (${phaseVar} >= 1.0) { ${phaseVar} -= Mathf.floor(${phaseVar}); }`);
      body.push(`  else if (${phaseVar} < 0.0) { ${phaseVar} -= Mathf.floor(${phaseVar}); }`);
      body.push(`}`);
      body.push(`phasorSample = ${phaseVar} * ${PHASOR_MAX};`);

      body.push("let effectiveBpm: f32 = bpmValue * (multiplier / division);");
      body.push(`if (effectiveBpm < ${CLOCK_MIN_BPM}) effectiveBpm = ${CLOCK_MIN_BPM};`);
      body.push(`if (effectiveBpm > ${CLOCK_MAX_BPM}) effectiveBpm = ${CLOCK_MAX_BPM};`);
      body.push(`let ${bpmCvVar}: f32 = 0.0;`);
      body.push("if (effectiveBpm > 0.0) {");
      body.push(`  ${bpmCvVar} = fastLog2(effectiveBpm / 120.0);`);
      body.push("}");
      body.push(`if (${bpmCvVar} < -10.0) ${bpmCvVar} = -10.0;`);
      body.push(`if (${bpmCvVar} > 10.0) ${bpmCvVar} = 10.0;`);

      lines.push(helpers.indentLines(body.join("\n"), 1));

      if (phasorAssignments) {
        lines.push(helpers.indentLines(phasorAssignments, 1));
      }
      if (bpmAssignments) {
        lines.push(helpers.indentLines(bpmAssignments, 1));
      }

      lines.push("}");
      return lines.join("\n");
    }
  }
};

export default phasorClockNode;
