import { PatchGraph } from "@graph/types";
import { createExecutionPlan, ExecutionPlan, PlanInput, PlanNode } from "./plan";
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
  const autoRoute = determineAutoRoute(plan);

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

  if (autoRoute.left) {
    processBodyLines.push(indentLines(`let ${AUTO_LEFT_VAR}: f32 = 0.0;`));
  }
  if (autoRoute.right) {
    processBodyLines.push(indentLines(`let ${AUTO_RIGHT_VAR}: f32 = 0.0;`));
  }

  for (const planNode of plan.nodes) {
    processBodyLines.push(
      indentLines(
        emitNode(planNode, { autoRoute }),
        1 /* already inside loop */
      )
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

const AUTO_LEFT_VAR = "auto_out_left";
const AUTO_RIGHT_VAR = "auto_out_right";

interface AutoRoute {
  left?: string;
  right?: string;
}

interface EmitContext {
  autoRoute: AutoRoute;
}

function emitNode(planNode: PlanNode, context: EmitContext): string {
  switch (planNode.node.kind) {
    case "osc.sine": {
      return emitSineNode(planNode, context);
    }
    case "mixer.stereo": {
      return emitMixerNode(planNode, context);
    }
    case "io.output": {
      return emitOutputNode(planNode, context);
    }
    default: {
      throw new Error(`Unsupported node kind for code generation: ${planNode.node.kind}`);
    }
  }
}

function emitMixerNode(planNode: PlanNode, context: EmitContext): string {
  const leftOutput = planNode.outputs.find((output) => output.port.id === "left");
  const rightOutput = planNode.outputs.find((output) => output.port.id === "right");

  if (!leftOutput || !rightOutput) {
    return `// ${planNode.node.label} (${planNode.node.id}) is missing stereo outputs.`;
  }

  const leftVar = `mix_${sanitizeIdentifier(planNode.node.id)}_left`;
  const rightVar = `mix_${sanitizeIdentifier(planNode.node.id)}_right`;

  const lines: string[] = [
    `// ${planNode.node.label} (${planNode.node.id})`,
    "{",
    indentLines(`let ${leftVar}: f32 = 0.0;`, 1),
    indentLines(`let ${rightVar}: f32 = 0.0;`, 1)
  ];

  for (const input of planNode.inputs) {
    if (!input.port.id.startsWith("ch")) {
      continue;
    }

    const sampleVar = `sample_${sanitizeIdentifier(planNode.node.id)}_${sanitizeIdentifier(input.port.id)}`;
    const gainKey = `gain_${input.port.id}`;
    const panKey = `pan_${input.port.id}`;
    const gainValue = numberLiteral(
      typeof planNode.node.parameters?.[gainKey] === "number"
        ? planNode.node.parameters![gainKey]
        : 1
    );
    const panValue = numberLiteral(
      typeof planNode.node.parameters?.[panKey] === "number"
        ? planNode.node.parameters![panKey]
        : 0
    );

    const expr = buildInputExpression(input);
    lines.push(indentLines(`let ${sampleVar}: f32 = ${expr};`, 1));
    lines.push(indentLines(`let gain_${input.port.id}: f32 = ${gainValue};`, 1));
    lines.push(indentLines(`let pan_${input.port.id}: f32 = ${panValue};`, 1));
    lines.push(
      indentLines(
        `${leftVar} += ${sampleVar} * gain_${input.port.id} * (0.5 * (1.0 - pan_${input.port.id}));`,
        1
      )
    );
    lines.push(
      indentLines(
        `${rightVar} += ${sampleVar} * gain_${input.port.id} * (0.5 * (1.0 + pan_${input.port.id}));`,
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
    lines.push(indentLines(leftAssignments, 1));
  }
  if (rightAssignments) {
    lines.push(indentLines(rightAssignments, 1));
  }

  if (context.autoRoute.left === planNode.node.id) {
    lines.push(indentLines(`${AUTO_LEFT_VAR} = ${leftVar};`, 1));
  }
  if (context.autoRoute.right === planNode.node.id) {
    lines.push(indentLines(`${AUTO_RIGHT_VAR} = ${rightVar};`, 1));
  }

  lines.push("}");

  return lines.join("\n");
}

function emitSineNode(planNode: PlanNode, context: EmitContext): string {
  const identifier = sanitizeIdentifier(planNode.node.id);
  const output = planNode.outputs.find((port) => port.port.id === "out");

  const isAutoRouted =
    context.autoRoute.left === planNode.node.id ||
    context.autoRoute.right === planNode.node.id;

  if (!output || (output.wires.length === 0 && !isAutoRouted)) {
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

  const autoAssignments: string[] = [];
  if (context.autoRoute.left === planNode.node.id) {
    autoAssignments.push(`${AUTO_LEFT_VAR} = sample;`);
  }
  if (context.autoRoute.right === planNode.node.id) {
    autoAssignments.push(`${AUTO_RIGHT_VAR} = sample;`);
  }

  const body = [
    `// ${planNode.node.label} (${planNode.node.id})`,
    "{",
    indentLines("let pitch: f32 = " + pitchExpr + ";", 1),
    indentLines("let frequency: f32 = FREQ_C4 * Mathf.pow(2.0, pitch);", 1),
    indentLines(`let sample: f32 = node_${identifier}.step(frequency);`, 1),
    assignments
      ? indentLines(assignments, 1)
      : !isAutoRouted
      ? indentLines("// No destinations for oscillator output.", 1)
      : "",
    autoAssignments.length > 0 ? indentLines(autoAssignments.join("\n"), 1) : "",
    "}"
  ];

  return body.join("\n");
}

function emitOutputNode(planNode: PlanNode, context: EmitContext): string {
  const leftInput = planNode.inputs.find((input) => input.port.id === "left");
  const rightInput = planNode.inputs.find((input) => input.port.id === "right");

  const leftExpr = leftInput
    ? buildInputExpression(leftInput, {
        autoVar:
          leftInput.wires.length === 0 && context.autoRoute.left
            ? AUTO_LEFT_VAR
            : undefined
      })
    : context.autoRoute.left
    ? AUTO_LEFT_VAR
    : numberLiteral(0);

  const rightExpr = rightInput
    ? buildInputExpression(rightInput, {
        autoVar:
          rightInput.wires.length === 0 && context.autoRoute.right
            ? AUTO_RIGHT_VAR
            : undefined
      })
    : context.autoRoute.right
    ? AUTO_RIGHT_VAR
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

function buildInputExpression(
  input: PlanInput,
  options: { autoVar?: string } = {}
): string {
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

  if (input.wires.length === 0 && options.autoVar) {
    terms.push(options.autoVar);
  }

  if (terms.length === 0) {
    terms.push(numberLiteral(input.fallbackValue));
  }

  return terms.length === 1 ? terms[0] : terms.join(" + ");
}

function determineAutoRoute(plan: ExecutionPlan): AutoRoute {
  const stereoCandidates = plan.nodes.filter((node) =>
    node.outputs.some((output) => output.port.id === "left") &&
    node.outputs.some((output) => output.port.id === "right")
  );

  const stereoWithFreeOutputs = stereoCandidates.filter((node) => {
    const left = node.outputs.find((output) => output.port.id === "left");
    const right = node.outputs.find((output) => output.port.id === "right");
    return (
      !!left &&
      !!right &&
      left.wires.length === 0 &&
      right.wires.length === 0
    );
  });

  const stereoPick = stereoWithFreeOutputs[0] ?? stereoCandidates[0];
  if (stereoPick) {
    return {
      left: stereoPick.node.id,
      right: stereoPick.node.id
    };
  }

  const outputInputs = plan.outputNode.inputs;
  const leftInput = outputInputs.find((input) => input.port.id === "left");
  const rightInput = outputInputs.find((input) => input.port.id === "right");

  const oscillatorNodes = plan.nodes.filter(
    (node) => node.node.kind === "osc.sine"
  );

  if (oscillatorNodes.length === 0) {
    return {};
  }

  const oscillatorsWithFreeOutput = oscillatorNodes.filter((node) =>
    node.outputs.some(
      (output) => output.port.id === "out" && output.wires.length === 0
    )
  );

  const candidates =
    oscillatorsWithFreeOutput.length > 0
      ? oscillatorsWithFreeOutput
      : oscillatorNodes;

  const autoRoute: AutoRoute = {};

  if (leftInput && leftInput.wires.length === 0 && candidates[0]) {
    autoRoute.left = candidates[0].node.id;
  }

  if (rightInput && rightInput.wires.length === 0) {
    const candidate =
      candidates.length > 1 ? candidates[1] : candidates[0] ?? null;
    if (candidate) {
      autoRoute.right = candidate.node.id;
    }
  }

  return autoRoute;
}
