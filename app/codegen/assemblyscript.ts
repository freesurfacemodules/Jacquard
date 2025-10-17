import { PatchGraph } from "@graph/types";
import {
  createExecutionPlan,
  ExecutionPlan,
  PlanInput
} from "./plan";
import {
  indentLines,
  numberLiteral,
  sanitizeIdentifier
} from "./utils/strings";
import {
  getNodeImplementation,
  nodeImplementations
} from "@dsp/library";
import type { AutoRoute, NodeEmitHelpers } from "@dsp/types";

export interface EmitOptions {
  moduleName?: string;
}

export interface EmitResult {
  source: string;
  plan: ExecutionPlan;
}

export function emitAssemblyScript(
  graph: PatchGraph,
  options: EmitOptions = {}
): EmitResult {
  const moduleName = options.moduleName ?? "maxwasm_patch";
  const plan = createExecutionPlan(graph);
  const autoRoute = determineAutoRoute(plan);

  const delayPrefetchLines: string[] = [];
  for (const planNode of plan.nodes) {
    if (planNode.node.kind !== "delay.ddl") {
      continue;
    }
    const identifier = sanitizeIdentifier(planNode.node.id);
    const delayVar = `delay_${identifier}`;
    const prefetchVar = `delay_${identifier}_prefetch`;
    const assignments: string[] = [];
    const output = planNode.outputs.find((candidate) => candidate.port.id === "out");
    if (output) {
      for (const wire of output.wires) {
        assignments.push(`${wire.varName} = ${prefetchVar};`);
      }
    }
    if (autoRoute.left === planNode.node.id) {
      assignments.push(`${AUTO_LEFT_VAR} = ${prefetchVar};`);
    }
    if (autoRoute.right === planNode.node.id) {
      assignments.push(`${AUTO_RIGHT_VAR} = ${prefetchVar};`);
    }
    if (assignments.length > 0) {
      delayPrefetchLines.push(`const ${prefetchVar}: f32 = ${delayVar}.prepare();`);
      delayPrefetchLines.push(...assignments);
    }
  }

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
    "const INV_SAMPLE_RATE_OVERSAMPLED: f32 = INV_SAMPLE_RATE / (<f32>OVERSAMPLING);",
    "const TAU: f32 = 6.283185307179586;",
    "const FREQ_C4: f32 = 261.6255653005986;"
  ].join("\n");

  const parameterSection = collectParameterSection(plan);
  const declarations = collectAssemblyDeclarations();
  const stateLines = collectStateDeclarations(plan);

  const processBodyLines: string[] = [];

  processBodyLines.push("for (let n = 0; n < BLOCK_SIZE; n++) {");

  if (plan.parameterCount > 0) {
    processBodyLines.push(
      indentLines(
        [
          "for (let p = 0; p < PARAM_COUNT; p++) {",
          "  const current = unchecked(parameterValues[p]);",
          "  const target = unchecked(parameterTargets[p]);",
          "  unchecked(parameterValues[p] = current + (target - current) * PARAM_SMOOTH);",
          "}"
        ].join("\n"),
        1
      )
    );
  }

  processBodyLines.push(
    indentLines("for (let step = 0; step < OVERSAMPLING; step++) {", 1)
  );

  if (plan.wires.length > 0) {
    const wireLines = plan.wires.map(
      (wire) => `let ${wire.varName}: f32 = 0.0;`
    );
    processBodyLines.push(indentLines(wireLines.join("\n"), 2));
  }

  if (autoRoute.left) {
    processBodyLines.push(indentLines(`let ${AUTO_LEFT_VAR}: f32 = 0.0;`, 2));
  }
  if (autoRoute.right) {
    processBodyLines.push(indentLines(`let ${AUTO_RIGHT_VAR}: f32 = 0.0;`, 2));
  }

  if (delayPrefetchLines.length > 0) {
    processBodyLines.push(indentLines(delayPrefetchLines.join("\n"), 2));
  }

  for (const planNode of plan.nodes) {
    const implementation = getNodeImplementation(planNode.node.kind);
    if (!implementation || !implementation.assembly?.emit) {
      throw new Error(
        `No AssemblyScript emitter registered for node kind "${planNode.node.kind}".`
      );
    }

    const snippet = implementation.assembly.emit(
      planNode,
      createEmitHelpers(autoRoute)
    );

    if (snippet && snippet.trim().length > 0) {
      processBodyLines.push(indentLines(snippet, 2));
    }
  }

  processBodyLines.push(indentLines("}", 1));
  processBodyLines.push(
    indentLines("const outLeft: f32 = downsampleLeft.output();", 1)
  );
  processBodyLines.push(
    indentLines("const outRight: f32 = downsampleRight.output();", 1)
  );
  processBodyLines.push(
    indentLines("store<f32>(ptrL + (n << 2), outLeft);", 1)
  );
  processBodyLines.push(
    indentLines("store<f32>(ptrR + (n << 2), outRight);", 1)
  );

  processBodyLines.push("}");

  const processFunction = [
    "export function process(ptrL: i32, ptrR: i32): void {",
    indentLines(processBodyLines.join("\n")),
    "}"
  ].join("\n");

  const source = [
    header,
    constants,
    parameterSection,
    declarations,
    stateLines,
    processFunction
  ]
    .filter(Boolean)
    .join("\n\n")
    .trimEnd()
    .concat("\n");

  return { source, plan };
}

const AUTO_LEFT_VAR = "auto_out_left";
const AUTO_RIGHT_VAR = "auto_out_right";
const DOWNSAMPLER_DECLARATION = `
const DOWNSAMPLE_TAPS = [
  -0.0002176010,
  0.0,
  0.0011521409,
  0.0,
  -0.0041649918,
  0.0,
  0.0115624329,
  0.0,
  -0.0257889088,
  0.0,
  0.0492123309,
  0.0,
  -0.0850986623,
  0.0,
  0.1380523615,
  0.0,
  0.7956409454,
  0.0,
  0.1380523615,
  0.0,
  -0.0850986623,
  0.0,
  0.0492123309,
  0.0,
  -0.0257889088,
  0.0,
  0.0115624329,
  0.0,
  -0.0041649918,
  0.0,
  0.0011521409,
  0.0,
  -0.0002176010
] as Array<f32>;
const DOWNSAMPLE_TAP_COUNT: i32 = DOWNSAMPLE_TAPS.length;

class HalfbandDownsampler {
  private history: StaticArray<f32> = new StaticArray<f32>(DOWNSAMPLE_TAP_COUNT);
  private offset: i32 = 0;
  private toggle: i32 = 0;

  reset(): void {
    for (let i = 0; i < DOWNSAMPLE_TAP_COUNT; i++) {
      unchecked(this.history[i] = 0.0);
    }
    this.offset = 0;
    this.toggle = 0;
  }

  push(sample: f32): bool {
    unchecked(this.history[this.offset] = sample);
    this.offset++;
    if (this.offset === DOWNSAMPLE_TAP_COUNT) {
      this.offset = 0;
    }
    this.toggle ^= 1;
    return this.toggle === 0;
  }

  output(): f32 {
    let acc: f32 = 0.0;
    let index = this.offset;
    for (let i = 0; i < DOWNSAMPLE_TAP_COUNT; i++) {
      acc += unchecked(DOWNSAMPLE_TAPS[i]) * unchecked(this.history[index]);
      index++;
      if (index === DOWNSAMPLE_TAP_COUNT) {
        index = 0;
      }
    }
    return acc;
  }
}

class Downsampler {
  private factor: i32;
  private stageCount: i32 = 0;
  private stage0: HalfbandDownsampler = new HalfbandDownsampler();
  private stage1: HalfbandDownsampler = new HalfbandDownsampler();
  private stage2: HalfbandDownsampler = new HalfbandDownsampler();
  private last: f32 = 0.0;

  constructor(factor: i32) {
    this.factor = factor;
    this.reset();
  }

  reset(): void {
    this.last = 0.0;
    this.stage0.reset();
    this.stage1.reset();
    this.stage2.reset();
    this.stageCount = 0;
    if (this.factor >= 2) {
      this.stageCount = 1;
    }
    if (this.factor >= 4) {
      this.stageCount = 2;
    }
    if (this.factor >= 8) {
      this.stageCount = 3;
    }
  }

  push(sample: f32): void {
    if (this.stageCount === 0) {
      this.last = sample;
      return;
    }
    let value = sample;
    if (this.stageCount >= 1) {
      if (!this.stage0.push(value)) {
        return;
      }
      value = this.stage0.output();
    }
    if (this.stageCount >= 2) {
      if (!this.stage1.push(value)) {
        return;
      }
      value = this.stage1.output();
    }
    if (this.stageCount >= 3) {
      if (!this.stage2.push(value)) {
        return;
      }
      value = this.stage2.output();
    }
    this.last = value;
  }

  output(): f32 {
    return this.last;
  }
}
`;

function createEmitHelpers(autoRoute: AutoRoute): NodeEmitHelpers {
  return {
    indentLines,
    numberLiteral,
    sanitizeIdentifier,
    buildInputExpression: (input: PlanInput, options?: { autoVar?: string }) =>
      buildInputExpression(input, options),
    parameterRef: (index: number) => `getParameterValue(${index})`,
    autoRoute,
    autoLeftVar: AUTO_LEFT_VAR,
    autoRightVar: AUTO_RIGHT_VAR
  };
}

function collectParameterSection(plan: ExecutionPlan): string {
  if (plan.parameterCount === 0) {
    return "";
  }

  const initLines = plan.controls
    .map((control) => {
      const literal = numberLiteral(control.defaultValue);
      return [
        `unchecked(parameterValues[${control.index}] = ${literal});`,
        `unchecked(parameterTargets[${control.index}] = ${literal});`
      ].join("\n");
    })
    .join("\n");

  return [
    `const PARAM_COUNT: i32 = ${plan.parameterCount};`,
    "const parameterValues = new StaticArray<f32>(PARAM_COUNT);",
    "const parameterTargets = new StaticArray<f32>(PARAM_COUNT);",
    "const PARAM_SMOOTH: f32 = 0.05;",
    "",
    "function initializeParameters(): void {",
    indentLines(initLines || "", 1),
    "}",
    "",
    "@inline function getParameterValue(index: i32): f32 {",
    indentLines("return unchecked(parameterValues[index]);", 1),
    "}",
    "",
    "export function setParameter(index: i32, value: f32): void {",
    indentLines(
      [
        "if (index >= 0 && index < PARAM_COUNT) {",
        "  unchecked(parameterTargets[index] = value);",
        "}"
      ].join("\n"),
      1
    ),
    "}",
    "",
    "initializeParameters();"
  ]
    .filter(Boolean)
    .join("\n");
}

function collectAssemblyDeclarations(): string {
  const declarations = new Set<string>();

  declarations.add(DOWNSAMPLER_DECLARATION.trim());

  for (const implementation of nodeImplementations) {
    const snippet = implementation.assembly?.declarations;
    if (snippet && snippet.trim().length > 0) {
      declarations.add(snippet.trim());
    }
  }

  if (declarations.size === 0) {
    return "";
  }

  return Array.from(declarations).join("\n\n");
}

function collectStateDeclarations(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push("const downsampleLeft = new Downsampler(OVERSAMPLING);");
  lines.push("const downsampleRight = new Downsampler(OVERSAMPLING);");
  lines.push("");
  lines.push("@inline function pushOutputSamples(left: f32, right: f32): void {");
  lines.push("  downsampleLeft.push(left);");
  lines.push("  downsampleRight.push(right);");
  lines.push("}");
  lines.push("");
  const oscNodes = plan.nodes.filter((planNode) => planNode.node.kind === "osc.sine");
  for (const planNode of oscNodes) {
    const identifier = sanitizeIdentifier(planNode.node.id);
    lines.push(`const node_${identifier} = new SineOsc();`);
  }

  const delayNodes = plan.nodes.filter((planNode) => planNode.node.kind === "delay.ddl");
  for (const planNode of delayNodes) {
    const identifier = sanitizeIdentifier(planNode.node.id);
    lines.push(`const delay_${identifier} = new DdlDelay();`);
  }

  const biquadNodes = plan.nodes.filter((planNode) => planNode.node.kind === "filter.biquad");
  for (const planNode of biquadNodes) {
    const identifier = sanitizeIdentifier(planNode.node.id);
    lines.push(`const biquad_${identifier} = new BiquadState();`);
  }

  const clockNodes = plan.nodes.filter((planNode) => planNode.node.kind === "clock.basic");
  for (const planNode of clockNodes) {
    const identifier = sanitizeIdentifier(planNode.node.id);
    lines.push(`let clock_phase_${identifier}: f32 = 0.0;`);
  }

  return lines.join("\n");
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
