import { PatchGraph } from "@graph/types";
import { createExecutionPlan, PlanInput, PlanNode } from "./plan";
import {
  indentLines,
  numberLiteral,
  sanitizeIdentifier
} from "./utils/strings";

export interface EmitOptions {
  moduleName?: string;
}

export function emitAssemblyScript(
  graph: PatchGraph,
  options: EmitOptions = {}
): string {
  const moduleName = options.moduleName ?? "maxwasm_patch";
  const plan = createExecutionPlan(graph);

  const header = [
    "// Auto-generated AssemblyScript module",
    `// Module: ${moduleName}`,
    `// Nodes: ${graph.nodes.length}`,
    `// Connections: ${graph.connections.length}`
  ].join("\n");

  const constants = [
    `export const SAMPLE_RATE: f32 = ${numberLiteral(graph.sampleRate)};`,
    `export const BLOCK_SIZE: i32 = ${graph.blockSize};`,
    `export const OVERSAMPLING: i32 = ${graph.oversampling};`,
    "",
    "const INV_SAMPLE_RATE: f32 = 1.0 / SAMPLE_RATE;",
    "const TAU: f32 = 6.283185307179586;",
    "const FREQ_C4: f32 = 261.6255653005986;"
  ].join("\n");

  const helpers = [
    "class SineOsc {",
    "  private phase: f32 = 0.0;",
    "",
    "  step(frequency: f32): f32 {",
    "    const phaseDelta: f32 = frequency * INV_SAMPLE_RATE * TAU;",
    "    this.phase += phaseDelta;",
    "    if (this.phase >= TAU) {",
    "      this.phase -= TAU;",
    "    }",
    "    return Mathf.sin(this.phase);",
    "  }",
    "}"
  ].join("\n");

  const sineNodes = plan.nodes.filter(
    (planNode) => planNode.node.kind === "osc.sine"
  );

  const stateLines =
    sineNodes.length > 0
      ? sineNodes
          .map((planNode) => {
            const identifier = sanitizeIdentifier(planNode.node.id);
            return `const node_${identifier} = new SineOsc();`;
          })
          .join("\n")
      : "";

  const processBodyLines: string[] = [];

  processBodyLines.push("for (let n = 0; n < BLOCK_SIZE; n++) {");

  if (plan.wires.length > 0) {
    const wireLines = plan.wires.map(
      (wire) => `let ${wire.varName}: f32 = 0.0;`
    );
    processBodyLines.push(indentLines(wireLines.join("\n")));
  }

  for (const planNode of plan.nodes) {
    processBodyLines.push(
      indentLines(emitNode(planNode), 1 /* already inside loop */)
    );
  }

  processBodyLines.push("}");

  const processFunction = [
    "export function process(ptrL: i32, ptrR: i32): void {",
    indentLines(processBodyLines.join("\n")),
    "}"
  ].join("\n");

  return [header, constants, helpers, stateLines, processFunction]
    .filter(Boolean)
    .join("\n\n")
    .trimEnd()
    .concat("\n");
}

function emitNode(planNode: PlanNode): string {
  switch (planNode.node.kind) {
    case "osc.sine": {
      return emitSineNode(planNode);
    }
    case "io.output": {
      return emitOutputNode(planNode);
    }
    default: {
      throw new Error(`Unsupported node kind for code generation: ${planNode.node.kind}`);
    }
  }
}

function emitSineNode(planNode: PlanNode): string {
  const identifier = sanitizeIdentifier(planNode.node.id);
  const output = planNode.outputs.find((port) => port.port.id === "out");

  if (!output || output.wires.length === 0) {
    return [
      `// ${planNode.node.label} (${planNode.node.id}) has no outgoing connections.`,
      "// Skipping oscillator evaluation to save CPU."
    ].join("\n");
  }

  const pitchInput = planNode.inputs.find(
    (input) => input.port.id === "pitch"
  );

  const pitchExpr = pitchInput
    ? buildInputExpression(pitchInput)
    : numberLiteral(0);

  const assignments = output.wires
    .map((wire) => `${wire.varName} = sample;`)
    .join("\n");

  const body = [
    `// ${planNode.node.label} (${planNode.node.id})`,
    "{",
    indentLines("let pitch: f32 = " + pitchExpr + ";", 1),
    indentLines("let frequency: f32 = FREQ_C4 * Mathf.pow(2.0, pitch);", 1),
    indentLines(`let sample: f32 = node_${identifier}.step(frequency);`, 1),
    indentLines(assignments || "// No destinations for oscillator output.", 1),
    "}"
  ];

  return body.join("\n");
}

function emitOutputNode(planNode: PlanNode): string {
  const leftInput = planNode.inputs.find((input) => input.port.id === "left");
  const rightInput = planNode.inputs.find((input) => input.port.id === "right");

  const leftExpr = leftInput
    ? buildInputExpression(leftInput)
    : numberLiteral(0);
  const rightExpr = rightInput
    ? buildInputExpression(rightInput)
    : numberLiteral(0);

  const body = [
    `// ${planNode.node.label} (${planNode.node.id})`,
    "{",
    indentLines(`let outLeft: f32 = ${leftExpr};`, 1),
    indentLines(`let outRight: f32 = ${rightExpr};`, 1),
    indentLines("store<f32>(ptrL + (n << 2), outLeft);", 1),
    indentLines("store<f32>(ptrR + (n << 2), outRight);", 1),
    "}"
  ];

  return body.join("\n");
}

function buildInputExpression(input: PlanInput): string {
  const terms: string[] = [];

  if (
    input.parameterValue !== null &&
    (input.parameterValue !== 0 || input.wires.length === 0)
  ) {
    terms.push(numberLiteral(input.parameterValue));
  }

  for (const wire of input.wires) {
    terms.push(wire.varName);
  }

  if (terms.length === 0) {
    terms.push(numberLiteral(input.fallbackValue));
  }

  return terms.length === 1 ? terms[0] : terms.join(" + ");
}
