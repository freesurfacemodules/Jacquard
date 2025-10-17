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
      createEmitHelpers()
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

const XOROSHIRO_DECLARATION = `
class Xoroshiro128Plus {
  private s0: u64 = 0x0123456789abcdef;
  private s1: u64 = 0xfedcba9876543210;

  constructor(seed0: u64 = 0x0123456789abcdef, seed1: u64 = 0xfedcba9876543210) {
    this.seed(seed0, seed1);
  }

  seed(seed0: u64, seed1: u64): void {
    if (seed0 == 0 && seed1 == 0) {
      seed1 = 0x1;
    }
    this.s0 = seed0;
    this.s1 = seed1;
    this.next();
  }

  private rotl(x: u64, k: i32): u64 {
    return (x << k) | (x >> (64 - k));
  }

  next(): u64 {
    let s0 = this.s0;
    let s1 = this.s1;
    const result = s0 + s1;

    s1 ^= s0;
    this.s0 = this.rotl(s0, 55) ^ s1 ^ (s1 << 14);
    this.s1 = this.rotl(s1, 36);

    return result;
  }

  uniform(): f32 {
    const value: u32 = <u32>(this.next() >> 32);
    return <f32>value * 2.3283064365386963e-10;
  }
}
`;

function createEmitHelpers(): NodeEmitHelpers {
  return {
    indentLines,
    numberLiteral,
    sanitizeIdentifier,
    buildInputExpression: (input: PlanInput) => buildInputExpression(input),
    parameterRef: (index: number) => `getParameterValue(${index})`
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
  declarations.add(XOROSHIRO_DECLARATION.trim());

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

  for (let index = 0; index < plan.nodes.length; index++) {
    const planNode = plan.nodes[index];
    const identifier = sanitizeIdentifier(planNode.node.id);
    switch (planNode.node.kind) {
      case "osc.sine": {
        lines.push(`const node_${identifier} = new SineOsc();`);
        break;
      }
      case "delay.ddl": {
        lines.push(`const delay_${identifier} = new DdlDelay();`);
        break;
      }
      case "filter.biquad": {
        lines.push(`const biquad_low_${identifier} = new BiquadState();`);
        lines.push(`const biquad_high_${identifier} = new BiquadState();`);
        break;
      }
      case "clock.basic": {
        lines.push(`let clock_phase_${identifier}: f32 = 0.0;`);
        break;
      }
      case "noise.basic": {
        const seedA = `0x9E3779B97F4A7C15 ^ (<u64>${index + 1})`;
        const seedB = `0xD1B54A32D192ED03 ^ (<u64>${index + 0xABCDEF})`;
        lines.push(`const noise_rng_${identifier} = new Xoroshiro128Plus(${seedA}, ${seedB});`);
        lines.push(`let noise_spare_${identifier}: f32 = 0.0;`);
        lines.push(`let noise_hasSpare_${identifier}: bool = false;`);
        break;
      }
      default:
        break;
    }
  }

  return lines.join("\n");
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

// Auto-routing has been removed; connections must be explicitly defined by the user.
