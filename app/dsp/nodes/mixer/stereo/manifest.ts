import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";

const CHANNEL_IDS = ["ch1", "ch2", "ch3", "ch4"];

export const stereoMixerNode: NodeImplementation = {
  manifest: {
    kind: "mixing.stereo",
    category: "mixing",
    label: "Stereo Mixer",
    inputs: CHANNEL_IDS.map((id, index) =>
      audioPort(id, `Channel ${index + 1}`)
    ),
    outputs: [audioPort("left", "Left"), audioPort("right", "Right")],
    defaultParams: CHANNEL_IDS.reduce<Record<string, number>>((acc, id) => {
      acc[`gain_${id}`] = 0;
      acc[`pan_${id}`] = 0;
      return acc;
    }, {}),
    appearance: {
      width: 260,
      height: 220,
      icon: "mixer",
      controlLayout: CHANNEL_IDS.map((id) => [`pan_${id}`, `gain_${id}`])
    },
    controls: CHANNEL_IDS.flatMap((id, index) => [
      {
        id: `pan_${id}`,
        label: `Pan ${index + 1}`,
        type: "slider" as const,
        min: -1,
        max: 1
      },
      {
        id: `gain_${id}`,
        label: `Level ${index + 1}`,
        type: "fader" as const,
        min: -96,
        max: 12
      }
    ])
  },
  assembly: {
    emit(planNode, helpers) {
      const leftOutput = planNode.outputs.find((output) => output.port.id === "left");
      const rightOutput = planNode.outputs.find((output) => output.port.id === "right");

      if (!leftOutput || !rightOutput) {
        return `// ${planNode.node.label} (${planNode.node.id}) is missing stereo outputs.`;
      }

      const id = helpers.sanitizeIdentifier(planNode.node.id);
      const leftVar = `mix_${id}_left`;
      const rightVar = `mix_${id}_right`;

      const lines: string[] = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`let ${leftVar}: f32 = 0.0;`, 1),
        helpers.indentLines(`let ${rightVar}: f32 = 0.0;`, 1)
      ];

      for (const input of planNode.inputs) {
        if (!CHANNEL_IDS.includes(input.port.id)) {
          continue;
        }

        const sanitizedChannel = helpers.sanitizeIdentifier(input.port.id);
        const sampleVar = `sample_${id}_${sanitizedChannel}`;
        const gainKey = `gain_${input.port.id}`;
        const panKey = `pan_${input.port.id}`;
        const gainControl = planNode.controls.find((control) => control.controlId === gainKey);
        const panControl = planNode.controls.find((control) => control.controlId === panKey);
        const gainDbExpr = gainControl
          ? helpers.parameterRef(gainControl.index)
          : helpers.numberLiteral(0);
        const panExpr = panControl
          ? helpers.parameterRef(panControl.index)
          : helpers.numberLiteral(0);

        const expr = helpers.buildInputExpression(input);
        lines.push(helpers.indentLines(`let ${sampleVar}: f32 = ${expr};`, 1));
        lines.push(helpers.indentLines(`let pan_${sanitizedChannel}: f32 = ${panExpr};`, 1));
        lines.push(helpers.indentLines(`if (pan_${sanitizedChannel} < -1.0) pan_${sanitizedChannel} = -1.0;`, 1));
        lines.push(helpers.indentLines(`if (pan_${sanitizedChannel} > 1.0) pan_${sanitizedChannel} = 1.0;`, 1));
        lines.push(helpers.indentLines(`let gainDb_${sanitizedChannel}: f32 = ${gainDbExpr};`, 1));
        lines.push(helpers.indentLines(`if (gainDb_${sanitizedChannel} < -96.0) gainDb_${sanitizedChannel} = -96.0;`, 1));
        lines.push(helpers.indentLines(`if (gainDb_${sanitizedChannel} > 12.0) gainDb_${sanitizedChannel} = 12.0;`, 1));
        lines.push(
          helpers.indentLines(
            `let gain_${sanitizedChannel}: f32 = fastExp(gainDb_${sanitizedChannel} * (LN10 * 0.05));`,
            1
          )
        );
        lines.push(
          helpers.indentLines(
            `${leftVar} += ${sampleVar} * gain_${sanitizedChannel} * (0.5 * (1.0 - pan_${sanitizedChannel}));`,
            1
          )
        );
        lines.push(
          helpers.indentLines(
            `${rightVar} += ${sampleVar} * gain_${sanitizedChannel} * (0.5 * (1.0 + pan_${sanitizedChannel}));`,
            1
          )
        );
      }

      const leftAssignments = leftOutput.wires
        .map((wire) => `${wire.varName} = ${leftVar};`)
        .join("\n");
      const rightAssignments = rightOutput.wires
        .map((wire) => `${wire.varName} = ${rightVar};`)
        .join("\n");

      if (leftAssignments) {
        lines.push(helpers.indentLines(leftAssignments, 1));
      }
      if (rightAssignments) {
        lines.push(helpers.indentLines(rightAssignments, 1));
      }

      lines.push("}");

      return lines.join("\n");
    }
  }
};
