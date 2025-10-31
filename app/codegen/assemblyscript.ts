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
import type { NodeEmitHelpers } from "@dsp/types";
import { flattenForCodegen } from "@graph/flatten";

export type MathMode = "fast" | "baseline";

export interface EmitOptions {
  moduleName?: string;
  mathMode?: MathMode;
}

export interface EmitResult {
  source: string;
  plan: ExecutionPlan;
  mathMode: MathMode;
}

export function emitAssemblyScript(
  graph: PatchGraph,
  options: EmitOptions = {}
): EmitResult {
  const moduleName = options.moduleName ?? "maxwasm_patch";
  const mathMode: MathMode = options.mathMode ?? "fast";
  const flattenedGraph = flattenForCodegen(graph);
  const plan = createExecutionPlan(flattenedGraph);

  const delayPrefetchLines: string[] = [];
  for (const planNode of plan.nodes) {
    if (
      planNode.node.kind !== "delay.ddl" &&
      planNode.node.kind !== "delay.waveguide"
    ) {
      continue;
    }
    const identifier = sanitizeIdentifier(planNode.node.id);
    const delayVar =
      planNode.node.kind === "delay.ddl"
        ? `delay_${identifier}`
        : `waveguide_${identifier}`;
    const prefetchVar = `${delayVar}_prefetch`;
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
    `// Nodes: ${flattenedGraph.nodes.length}`,
    `// Connections: ${flattenedGraph.connections.length}`
  ].join("\n");

  const constants = [
    `export const SAMPLE_RATE: f32 = ${numberLiteral(flattenedGraph.sampleRate)};`,
    `export const BLOCK_SIZE: i32 = ${flattenedGraph.blockSize};`,
    `export const OVERSAMPLING: i32 = ${flattenedGraph.oversampling};`,
    "",
    "const INV_SAMPLE_RATE: f32 = 1.0 / SAMPLE_RATE;",
    "const INV_SAMPLE_RATE_OVERSAMPLED: f32 = INV_SAMPLE_RATE / (<f32>OVERSAMPLING);",
    "const TAU: f32 = 6.283185307179586;",
    "const PI: f32 = 3.141592653589793;",
    "const HALF_PI: f32 = 1.5707963267948966;",
    "const TWO_PI: f32 = TAU;",
    "const FREQ_C4: f32 = 261.6255653005986;",
    "const LN2: f32 = 0.6931471805599453;",
    "const INV_LN2: f32 = 1.4426950408889634;",
    "const LN10: f32 = 2.302585092994046;"
  ].join("\n");

  const mathSection = buildMathSection(mathMode);

  const parameterSection = collectParameterSection(plan);
  const monitorSection = collectMonitorSections(plan);
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
    mathSection,
    parameterSection,
    monitorSection,
    declarations,
    stateLines,
    processFunction
  ]
    .filter(Boolean)
    .join("\n\n")
    .trimEnd()
    .concat("\n");

  return { source, plan, mathMode };
}

function buildMathSection(mode: MathMode): string {
  if (mode === "baseline") {
    return `
class FastTrigResult {
  sin: f32 = 0.0;
  cos: f32 = 0.0;
}

@inline
export function fastSinCosInto(x: f32, out: FastTrigResult): void {
  out.sin = Mathf.sin(x);
  out.cos = Mathf.cos(x);
}

@inline
export function fastSin(x: f32): f32 {
  return Mathf.sin(x);
}

@inline
export function fastCos(x: f32): f32 {
  return Mathf.cos(x);
}

@inline
export function fastExp2(x: f32): f32 {
  return Mathf.pow(2.0, x);
}

@inline
export function fastExp(x: f32): f32 {
  return Mathf.exp(x);
}

@inline
export function fastLog2(x: f32): f32 {
  return Mathf.log2(x);
}

@inline
export function fastLog(x: f32): f32 {
  return Mathf.log(x);
}

@inline
export function fastPow(base: f32, exponent: f32): f32 {
  return Mathf.pow(base, exponent);
}
`.trim();
  }

  return `
const FAST_SIN_C1: f32 = 0.9997714075153924;
const FAST_SIN_C3: f32 = -0.16582704279148017;
const FAST_SIN_C5: f32 = 0.007574247764355203;
const FAST_COS_C0: f32 = FAST_SIN_C1;
const FAST_COS_C2: f32 = 3.0 * FAST_SIN_C3;
const FAST_COS_C4: f32 = 5.0 * FAST_SIN_C5;
const INV_HALF_PI: f32 = 2.0 / PI;

class FastTrigResult {
  sin: f32 = 0.0;
  cos: f32 = 0.0;
}

@inline
function copysignf(a: f32, b: f32): f32 {
  return reinterpret<f32>((reinterpret<i32>(a) & 0x7FFFFFFF) | (reinterpret<i32>(b) & 0x80000000));
}

@inline
function infinityf(): f32 {
  return reinterpret<f32>(0x7F800000);
}

@inline
function scalbnf(x: f32, n: i32): f32 {
  let ix: i32 = reinterpret<i32>(x);
  let e: i32 = (ix >>> 23) & 0xFF;
  if (e == 0) {
    if ((ix & 0x7FFFFFFF) == 0) return x;
    x *= 8388608.0;
    ix = reinterpret<i32>(x);
    e = ((ix >>> 23) & 0xFF) - 23;
  }
  e += n;
  if (e <= 0) {
    return copysignf(0.0, x);
  }
  if (e >= 0xFF) {
    return copysignf(infinityf(), x);
  }
  ix = (ix & 0x807FFFFF) | (e << 23);
  return reinterpret<f32>(ix);
}

@inline
function fastSinPoly(x: f32): f32 {
  const x2: f32 = x * x;
  const x4: f32 = x2 * x2;
  return x * (FAST_SIN_C1 + x2 * (FAST_SIN_C3 + FAST_SIN_C5 * x4));
}

@inline
function fastCosPoly(x: f32): f32 {
  const x2: f32 = x * x;
  const x4: f32 = x2 * x2;
  return FAST_COS_C0 + x2 * (FAST_COS_C2 + FAST_COS_C4 * x4);
}

@inline
function resolveTrig(q: i32, sin_r: f32, cos_r: f32, out: FastTrigResult): void {
  let sinVal: f32;
  let cosVal: f32;
  switch (q & 3) {
    case 0: { sinVal = sin_r; cosVal = cos_r; break; }
    case 1: { sinVal = cos_r; cosVal = -sin_r; break; }
    case 2: { sinVal = -sin_r; cosVal = -cos_r; break; }
    default: { sinVal = -cos_r; cosVal = sin_r; break; }
  }
  out.sin = sinVal;
  out.cos = cosVal;
}

@inline
export function fastSinCosInto(x: f32, out: FastTrigResult): void {
  const kf: f32 = Mathf.round(x * INV_HALF_PI);
  const r: f32 = x - kf * HALF_PI;
  const sin_r: f32 = fastSinPoly(r);
  const cos_r: f32 = fastCosPoly(r);
  resolveTrig(<i32>kf, sin_r, cos_r, out);
}

@inline
export function fastSin(x: f32): f32 {
  const kf: f32 = Mathf.round(x * INV_HALF_PI);
  const r: f32 = x - kf * HALF_PI;
  const sin_r: f32 = fastSinPoly(r);
  const cos_r: f32 = fastCosPoly(r);
  switch (<i32>kf & 3) {
    case 0: return sin_r;
    case 1: return cos_r;
    case 2: return -sin_r;
    default: return -cos_r;
  }
}

@inline
export function fastCos(x: f32): f32 {
  const kf: f32 = Mathf.round(x * INV_HALF_PI);
  const r: f32 = x - kf * HALF_PI;
  const sin_r: f32 = fastSinPoly(r);
  const cos_r: f32 = fastCosPoly(r);
  switch (<i32>kf & 3) {
    case 0: return cos_r;
    case 1: return -sin_r;
    case 2: return -cos_r;
    default: return sin_r;
  }
}

@inline
function exp2_poly5(f: f32): f32 {
  const c1: f32 = 0.6931471;
  const c2: f32 = 0.24022864;
  const c3: f32 = 0.055483963;
  const c4: f32 = 0.009696383;
  const c5: f32 = 0.0012615042;
  const f2: f32 = f * f;
  const t1: f32 = c4 + c5 * f;
  const t0: f32 = c2 + c3 * f;
  return 1.0 + f * (c1 + f2 * t1 + f * t0);
}

@inline
export function fastExp2(x: f32): f32 {
  const nFloat: f32 = Mathf.floor(x);
  const f: f32 = x - nFloat;
  return scalbnf(exp2_poly5(f), <i32>nFloat);
}

@inline
export function fastExp(x: f32): f32 {
  return fastExp2(x * INV_LN2);
}

@inline
function log2_poly_odd(t: f32): f32 {
  const a1: f32 = 2.879534;
  const a3: f32 = 1.0615557;
  const a5: f32 = 0.20025732;
  const a7: f32 = 0.03138555;
  const t2: f32 = t * t;
  return t * (a1 + t2 * (a3 + t2 * (a5 + t2 * a7)));
}

@inline
export function fastLog2(x: f32): f32 {
  if (x <= 0.0) {
    return -infinityf();
  }
  let ix: i32 = reinterpret<i32>(x);
  let e: i32 = (ix >>> 23) & 0xFF;
  if (e == 0) {
    x *= 8388608.0;
    ix = reinterpret<i32>(x);
    e = ((ix >>> 23) & 0xFF) - 23;
  }
  const mBits: i32 = (ix & 0x807FFFFF) | (126 << 23);
  const m: f32 = reinterpret<f32>(mBits);
  const exponent: f32 = <f32>(e - 126);
  const t: f32 = (m - 1.0) / (m + 1.0);
  return exponent + log2_poly_odd(t);
}

@inline
export function fastLog(x: f32): f32 {
  return fastLog2(x) * LN2;
}

@inline
export function fastPow(base: f32, exponent: f32): f32 {
  if (base <= 0.0) {
    return 0.0;
  }
  return fastExp(exponent * fastLog(base));
}
`.trim();
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

const DCBLOCK_DECLARATION = `
class DcBlocker {
  private r: f32 = 0.0;
  private g: f32 = 1.0;
  private x1: f32 = 0.0;
  private y1: f32 = 0.0;

  constructor() {
    this.setCutoff(SAMPLE_RATE * (<f32>OVERSAMPLING), 10.0);
  }

  reset(): void {
    this.x1 = 0.0;
    this.y1 = 0.0;
  }

  setCutoff(sampleRate: f32, cutoff: f32): void {
    let fc = cutoff;
    if (fc < 0.001) fc = 0.001;
    const rValue = fastExp(-2.0 * PI * fc / sampleRate);
    this.r = rValue;
    this.g = 0.5 * (1.0 + rValue);
  }

  process(input: f32): f32 {
    const y = this.g * (input - this.x1) + this.r * this.y1;
    this.x1 = input;
    this.y1 = y;
    return y;
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

function collectMonitorSections(plan: ExecutionPlan): string {
  const sections: string[] = [];
  const envelopeSection = collectEnvelopeSection(plan);
  if (envelopeSection) {
    sections.push(envelopeSection);
  }
  const scopeSection = collectScopeSection(plan);
  if (scopeSection) {
    sections.push(scopeSection);
  }
  return sections.join("\n\n");
}

function collectEnvelopeSection(plan: ExecutionPlan): string {
  const count = plan.envelopeMonitors.length;
  if (count === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push(`const ENVELOPE_MONITOR_COUNT: i32 = ${count};`);
  lines.push("const envelopeMonitorValues = new StaticArray<f32>(ENVELOPE_MONITOR_COUNT * 2);");
  lines.push("");
  lines.push("@inline function setEnvelopeMonitor(index: i32, value: f32, progress: f32): void {");
  lines.push("  const base = index * 2;");
  lines.push("  unchecked(envelopeMonitorValues[base] = value);");
  lines.push("  unchecked(envelopeMonitorValues[base + 1] = progress);");
  lines.push("}");
  lines.push("");
  lines.push("export function getEnvelopeMonitorPointer(): i32 {");
  lines.push("  return changetype<i32>(envelopeMonitorValues);");
  lines.push("}");
  lines.push("");
  lines.push("export function getEnvelopeMonitorCount(): i32 {");
  lines.push("  return ENVELOPE_MONITOR_COUNT;");
  lines.push("}");
  return lines.join("\n");
}

function collectScopeSection(plan: ExecutionPlan): string {
  const count = plan.scopeMonitors.length;
  if (count === 0) {
    return "";
  }

  const firstMonitor = plan.scopeMonitors[0];
  const capacity = firstMonitor?.capacity ?? 1024;
  const levelFactors = firstMonitor?.levelFactors ?? [1];
  const levelCount = levelFactors.length;
  const levelFactorsLiteral = levelFactors.map((factor) => factor.toString()).join(", ");
  const metaStride = levelCount * 3 + 3;
  const refreshInterval = Math.max(1, Math.round(plan.sampleRate / 120));
  const lines: string[] = [];
  lines.push(`const SCOPE_MONITOR_COUNT: i32 = ${count};`);
  lines.push(`const SCOPE_MONITOR_CAPACITY: i32 = ${capacity};`);
  lines.push(`const SCOPE_LEVEL_COUNT: i32 = ${levelCount};`);
  lines.push(`const SCOPE_LEVEL_FACTORS = [${levelFactorsLiteral}] as Array<i32>;`);
  lines.push(`const SCOPE_MONITOR_META_STRIDE: i32 = ${metaStride};`);
  lines.push(`const SCOPE_REFRESH_INTERVAL: i32 = ${refreshInterval};`);
  lines.push("const scopeMonitorBuffers = new StaticArray<f32>(SCOPE_MONITOR_COUNT * SCOPE_LEVEL_COUNT * SCOPE_MONITOR_CAPACITY);");
  lines.push("const scopeMonitorMeta = new StaticArray<f32>(SCOPE_MONITOR_COUNT * SCOPE_MONITOR_META_STRIDE);");
  lines.push("const scopeMonitorWriteIndex = new StaticArray<i32>(SCOPE_MONITOR_COUNT * SCOPE_LEVEL_COUNT);");
  lines.push("const scopeMonitorCaptured = new StaticArray<i32>(SCOPE_MONITOR_COUNT * SCOPE_LEVEL_COUNT);");
  lines.push("const scopeMonitorDownsample = new StaticArray<i32>(SCOPE_MONITOR_COUNT * SCOPE_LEVEL_COUNT);");
  lines.push("const scopeMonitorMode = new StaticArray<i32>(SCOPE_MONITOR_COUNT);");
  lines.push("const scopeMonitorTargetSamples = new StaticArray<i32>(SCOPE_MONITOR_COUNT);");
  lines.push("const scopeMonitorScale = new StaticArray<f32>(SCOPE_MONITOR_COUNT);");
  lines.push("const scopeMonitorTime = new StaticArray<f32>(SCOPE_MONITOR_COUNT);");
  lines.push("const scopeMonitorRefreshCounter = new StaticArray<i32>(SCOPE_MONITOR_COUNT);");
  lines.push("");
  lines.push("export function getScopeMonitorBufferPointer(): i32 {");
  lines.push("  return changetype<i32>(scopeMonitorBuffers);");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeMonitorMetaPointer(): i32 {");
  lines.push("  return changetype<i32>(scopeMonitorMeta);");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeMonitorCount(): i32 {");
  lines.push("  return SCOPE_MONITOR_COUNT;");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeMonitorCapacity(): i32 {");
  lines.push("  return SCOPE_MONITOR_CAPACITY;");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeMonitorMetaStride(): i32 {");
  lines.push("  return SCOPE_MONITOR_META_STRIDE;");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeLevelCount(): i32 {");
  lines.push("  return SCOPE_LEVEL_COUNT;");
  lines.push("}");
  lines.push("");
  lines.push("export function getScopeLevelFactorsPointer(): i32 {");
  lines.push("  return changetype<i32>(SCOPE_LEVEL_FACTORS);");
  lines.push("}");
  return lines.join("\n");
}

function collectAssemblyDeclarations(): string {
  const declarations = new Set<string>();

  declarations.add(DOWNSAMPLER_DECLARATION.trim());
  declarations.add(XOROSHIRO_DECLARATION.trim());
  declarations.add(DCBLOCK_DECLARATION.trim());

  for (const implementation of nodeImplementations) {
    const snippet = implementation.assembly?.declarations;
    if (!snippet) {
      continue;
    }

    if (Array.isArray(snippet)) {
      for (const entry of snippet) {
        if (entry && entry.trim().length > 0) {
          declarations.add(entry.trim());
        }
      }
    } else if (snippet.trim().length > 0) {
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
      case "osc.analog": {
        lines.push(`const analog_${identifier} = new AnalogOsc();`);
        break;
      }
      case "delay.ddl": {
        lines.push(`const delay_${identifier} = new DdlDelay();`);
        break;
      }
      case "delay.waveguide": {
        lines.push(`const waveguide_${identifier} = new WaveguideDelay();`);
        break;
      }
      case "filter.biquad": {
        lines.push(`const biquad_low_${identifier} = new BiquadState();`);
        lines.push(`const biquad_high_${identifier} = new BiquadState();`);
        lines.push(`const biquad_trig_${identifier} = new FastTrigResult();`);
        break;
      }
      case "filter.ladder": {
        const seedA = `0x9E3779B97F4A7C15 ^ (<u64>${index + 0x1234})`;
        const seedB = `0xD1B54A32D192ED03 ^ (<u64>${index + 0x5678})`;
        lines.push(`const ladder_${identifier} = new LadderFilter();`);
        lines.push(`const ladder_rng_${identifier} = new Xoroshiro128Plus(${seedA}, ${seedB});`);
        break;
      }
      case "utility.scope": {
        lines.push(`const scope_trig_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        break;
      }
      case "envelope.ad": {
        lines.push(`const schmitt_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        lines.push(`const env_${identifier} = new AdEnvelope();`);
        break;
      }
      case "clock.basic": {
        lines.push(`let clock_phase_${identifier}: f32 = 0.0;`);
        lines.push(`const clock_reset_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        break;
      }
      case "noise.basic": {
        const seedA = `0x9E3779B97F4A7C15 ^ (<u64>${index + 1})`;
        const seedB = `0xD1B54A32D192ED03 ^ (<u64>${index + 0xABCDEF})`;
        lines.push(`const noise_rng_${identifier} = new Xoroshiro128Plus(${seedA}, ${seedB});`);
        lines.push(`let noise_spare_${identifier}: f32 = 0.0;`);
        lines.push(`let noise_hasSpare_${identifier}: bool = false;`);
        lines.push(`const noise_trig_${identifier} = new FastTrigResult();`);
        break;
      }
      case "utility.slew": {
        lines.push(`const slew_${identifier} = new SlewLimiter();`);
        break;
      }
      case "utility.dcbias": {
        lines.push(`const dcblock_${identifier} = new DcBlocker();`);
        break;
      }
      case "utility.samplehold": {
        lines.push(`let snh_state_${identifier}: f32 = 0.0;`);
        lines.push(`const snh_trig_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        break;
      }
      case "random.seeded": {
        const seedA = `0x9E3779B97F4A7C15 ^ (<u64>${index + 0x4242})`;
        const seedB = `0xD1B54A32D192ED03 ^ (<u64>${index + 0x123456})`;
        lines.push(`const seeded_rng_${identifier} = new Xoroshiro128Plus(${seedA}, ${seedB});`);
        lines.push(`const seeded_trigger_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        lines.push(`const seeded_reseed_${identifier} = new SchmittTrigger(2.5, 1.0);`);
        lines.push(`let seeded_seed_${identifier}: i32 = -1;`);
        lines.push(`let seeded_initialized_${identifier}: bool = false;`);
        lines.push(`let seeded_value_${identifier}: f32 = 0.0;`);
        break;
      }
      case "logic.counter": {
        lines.push(`const counter_${identifier} = new CounterState();`);
        break;
      }
      default:
        break;
    }
  }

  return lines.join("\n");
}

function buildInputExpression(input: PlanInput): string {
  if (input.wires.length === 0) {
    if (input.parameterValue !== null) {
      return numberLiteral(input.parameterValue);
    }
    return numberLiteral(input.fallbackValue);
  }

  const terms = input.wires.map((wire) => wire.varName);
  return terms.length === 1 ? terms[0] : terms.join(" + ");
}

// Auto-routing has been removed; connections must be explicitly defined by the user.
