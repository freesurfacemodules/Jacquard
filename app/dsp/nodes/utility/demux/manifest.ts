import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";

const INPUT_SIGNAL = "in";
const INPUT_SEL = "sel";
const OUTPUT_A = "outA";
const OUTPUT_B = "outB";

export const demultiplexerNode: NodeImplementation = {
  manifest: {
    kind: "utility.demux",
    category: "utility",
    label: "1x2 Demux",
    inputs: [
      audioPort(INPUT_SIGNAL, "Signal"),
      audioPort(INPUT_SEL, "Select")
    ],
    outputs: [
      audioPort(OUTPUT_A, "Out A"),
      audioPort(OUTPUT_B, "Out B")
    ],
    appearance: {
      width: 220,
      height: 160,
      icon: "square-split-horizontal"
    }
  },
  assembly: {
    emit(planNode, helpers) {
      const inputSignal = planNode.inputs.find((entry) => entry.port.id === INPUT_SIGNAL);
      const inputSel = planNode.inputs.find((entry) => entry.port.id === INPUT_SEL);
      const outputA = planNode.outputs.find((entry) => entry.port.id === OUTPUT_A);
      const outputB = planNode.outputs.find((entry) => entry.port.id === OUTPUT_B);

      if (!inputSignal || !inputSel || !outputA || !outputB) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const exprSignal = helpers.buildInputExpression(inputSignal);
      const exprSel = helpers.buildInputExpression(inputSel);

      const assignA = outputA.wires.map((wire) => `${wire.varName} = demuxA;`).join("\n");
      const assignB = outputB.wires.map((wire) => `${wire.varName} = demuxB;`).join("\n");

      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(`const sel: f32 = ${exprSel};`, 1),
        helpers.indentLines(`const signal: f32 = ${exprSignal};`, 1),
        helpers.indentLines("const isB: bool = sel >= 0.5;", 1),
        helpers.indentLines("const demuxA: f32 = isB ? 0.0 : signal;", 1),
        helpers.indentLines("const demuxB: f32 = isB ? signal : 0.0;", 1),
        assignA ? helpers.indentLines(assignA, 1) : "",
        assignB ? helpers.indentLines(assignB, 1) : "",
        "}"
      ];

      return lines.filter(Boolean).join("\n");
    }
  }
};

export default demultiplexerNode;
