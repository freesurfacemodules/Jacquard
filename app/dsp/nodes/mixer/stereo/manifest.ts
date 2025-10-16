import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";

const CHANNEL_IDS = ["ch1", "ch2", "ch3", "ch4"];

export const stereoMixerNode: NodeImplementation = {
  manifest: {
    kind: "mixer.stereo",
    category: "utility",
    label: "Stereo Mixer",
    inputs: CHANNEL_IDS.map((id, index) =>
      audioPort(id, `Channel ${index + 1}`)
    ),
    outputs: [audioPort("left", "Left"), audioPort("right", "Right")],
    defaultParams: CHANNEL_IDS.reduce<Record<string, number>>((acc, id) => {
      acc[`gain_${id}`] = 1;
      acc[`pan_${id}`] = 0;
      return acc;
    }, {}),
    appearance: {
      width: 220,
      height: 160,
      icon: "mixer"
    }
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
        const gainValue = helpers.numberLiteral(
          typeof planNode.node.parameters?.[gainKey] === "number"
            ? planNode.node.parameters![gainKey]
            : 1
        );
        const panValue = helpers.numberLiteral(
          typeof planNode.node.parameters?.[panKey] === "number"
            ? planNode.node.parameters![panKey]
            : 0
        );

        const expr = helpers.buildInputExpression(input);
        lines.push(helpers.indentLines(`let ${sampleVar}: f32 = ${expr};`, 1));
        lines.push(helpers.indentLines(`let gain_${sanitizedChannel}: f32 = ${gainValue};`, 1));
        lines.push(helpers.indentLines(`let pan_${sanitizedChannel}: f32 = ${panValue};`, 1));
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

      if (helpers.autoRoute.left === planNode.node.id) {
        lines.push(helpers.indentLines(`${helpers.autoLeftVar} = ${leftVar};`, 1));
      }
      if (helpers.autoRoute.right === planNode.node.id) {
        lines.push(helpers.indentLines(`${helpers.autoRightVar} = ${rightVar};`, 1));
      }

      lines.push("}");

      return lines.join("\n");
    }
  }
};
