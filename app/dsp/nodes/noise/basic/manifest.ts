import { audioPort } from "../../common";
import { NodeImplementation } from "@dsp/types";

export const noiseNode: NodeImplementation = {
  manifest: {
    kind: "noise.basic",
    category: "utility",
    label: "Noise",
    inputs: [],
    outputs: [audioPort("uniform", "Uniform"), audioPort("normal", "Normal")],
    appearance: {
      width: 200,
      height: 140,
      icon: "sparkles"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const uniformOut = planNode.outputs.find((output) => output.port.id === "uniform");
      const normalOut = planNode.outputs.find((output) => output.port.id === "normal");

      if (!uniformOut || !normalOut) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing outputs.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const rngVar = `noise_rng_${identifier}`;
      const spareVar = `noise_spare_${identifier}`;
      const hasSpareVar = `noise_hasSpare_${identifier}`;

      const uniformAssignments = uniformOut.wires
        .map((wire) => `${wire.varName} = uniformSample;`)
        .join("\n");

      const normalAssignments = normalOut.wires
        .map((wire) => `${wire.varName} = normalSample;`)
        .join("\n");

      return [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const uniformSample: f32 = (${rngVar}.uniform() * 10.0) - 5.0;`, 1),
        helpers.indentLines("let normalSample: f32 = 0.0;", 1),
        helpers.indentLines(
          [
            `if (${hasSpareVar}) {`,
            `  normalSample = ${spareVar};`,
            `  ${hasSpareVar} = false;`,
            `} else {`,
            `  let u1: f32 = ${rngVar}.uniform();`,
            `  if (u1 <= 1e-7) u1 = 1e-7;`,
            `  let u2: f32 = ${rngVar}.uniform();`,
            `  const radius: f32 = Mathf.sqrt(-2.0 * Mathf.log(u1));`,
            `  const theta: f32 = TAU * u2;`,
            `  normalSample = radius * Mathf.cos(theta) * 5.0;`,
            `  ${spareVar} = radius * Mathf.sin(theta) * 5.0;`,
            `  ${hasSpareVar} = true;`,
            `}`
          ].join("\n"),
          1
        ),
        uniformAssignments ? helpers.indentLines(uniformAssignments, 1) : "",
        normalAssignments ? helpers.indentLines(normalAssignments, 1) : "",
        "}"
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
};
