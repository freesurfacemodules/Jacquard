import { audioPort } from "../common";
import { NodeImplementation } from "@dsp/types";

const BPM_CONTROL = "bpm";
const MULT_CONTROL = "mult";
const DIV_CONTROL = "div";

export const clockNode: NodeImplementation = {
  manifest: {
    kind: "clock.basic",
    category: "utility",
    label: "Clock",
    inputs: [],
    outputs: [audioPort("out", "Out")],
    defaultParams: {
      [BPM_CONTROL]: 120,
      [MULT_CONTROL]: 1,
      [DIV_CONTROL]: 1
    },
    appearance: {
      width: 200,
      height: 160,
      icon: "metronome"
    },
    controls: [
      {
        id: BPM_CONTROL,
        label: "BPM",
        type: "slider",
        min: 30,
        max: 300,
        step: 0.1
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
    emit(planNode, helpers) {
      const output = planNode.outputs.find((entry) => entry.port.id === "out");
      const bpmControl = planNode.controls.find((entry) => entry.controlId === BPM_CONTROL);
      const multControl = planNode.controls.find((entry) => entry.controlId === MULT_CONTROL);
      const divControl = planNode.controls.find((entry) => entry.controlId === DIV_CONTROL);

      if (!output || !bpmControl || !multControl || !divControl) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const phaseVar = `clock_phase_${identifier}`;
      const outputAssignments = output.wires
        .map((wire) => `${wire.varName} = clockSample;`)
        .join("\n");

      const autoAssignments: string[] = [];
      if (helpers.autoRoute.left === planNode.node.id) {
        autoAssignments.push(`${helpers.autoLeftVar} = clockSample;`);
      }
      if (helpers.autoRoute.right === planNode.node.id) {
        autoAssignments.push(`${helpers.autoRightVar} = clockSample;`);
      }

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(
          [
            `const bpm: f32 = Mathf.clamp(${helpers.parameterRef(bpmControl.index)}, 30.0, 300.0);`,
            `const multiplier: f32 = Mathf.max(1.0, Mathf.round(${helpers.parameterRef(multControl.index)}));`,
            `const division: f32 = Mathf.max(1.0, Mathf.round(${helpers.parameterRef(divControl.index)}));`,
            "const beatsPerSecond: f32 = bpm / 60.0;",
            "const frequency: f32 = beatsPerSecond * multiplier / division;",
            "const phaseDelta: f32 = frequency * INV_SAMPLE_RATE_OVERSAMPLED * TAU;",
            `${phaseVar} += phaseDelta;`,
            `if (${phaseVar} >= TAU) { ${phaseVar} -= TAU; }`,
            `const clockSample: f32 = ${phaseVar} < (TAU * 0.5) ? 1.0 : -1.0;`
          ].join("\n"),
          1
        ),
        outputAssignments ? helpers.indentLines(outputAssignments, 1) : "",
        autoAssignments.length ? helpers.indentLines(autoAssignments.join("\n"), 1) : "",
        "}"
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
};
