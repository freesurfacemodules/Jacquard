import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const SIGNAL_INPUT = "signal";
const TRIGGER_INPUT = "trigger";

const SCALE_CONTROL = "scale";
const TIME_CONTROL = "time";

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const MIN_TIME = 0.001;
const MAX_TIME = 0.5;

export const oscilloscopeNode: NodeImplementation = {
  manifest: {
    kind: "utility.scope",
    category: "utility",
    label: "Oscilloscope",
    inputs: [
      audioPort(SIGNAL_INPUT, "Signal"),
      audioPort(TRIGGER_INPUT, "Trigger")
    ],
    outputs: [],
    defaultParams: {
      [SCALE_CONTROL]: 5,
      [TIME_CONTROL]: 0.05
    },
    appearance: {
      width: 260,
      height: 220,
      icon: "wave-square"
    },
    controls: [
      {
        id: SCALE_CONTROL,
        label: "Scale (V)",
        type: "slider",
        min: MIN_SCALE,
        max: MAX_SCALE,
        step: 0.1
      },
      {
        id: TIME_CONTROL,
        label: "Time (s)",
        type: "slider",
        min: MIN_TIME,
        max: MAX_TIME,
        step: 0.001
      }
    ]
  },
  assembly: {
    declarations: schmittTriggerSource,
    emit(planNode, helpers) {
      const signalInput = planNode.inputs.find((entry) => entry.port.id === SIGNAL_INPUT);
      const triggerInput = planNode.inputs.find((entry) => entry.port.id === TRIGGER_INPUT);
      const scaleControl = planNode.controls.find((entry) => entry.controlId === SCALE_CONTROL);
      const timeControl = planNode.controls.find((entry) => entry.controlId === TIME_CONTROL);
      const scopeMonitorIndex =
        typeof planNode.scopeMonitorIndex === "number" ? planNode.scopeMonitorIndex : -1;

      if (!signalInput || !scaleControl || !timeControl || scopeMonitorIndex < 0) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const schmittVar = `scope_trig_${identifier}`;
      const signalExpr = helpers.buildInputExpression(signalInput);
      const triggerExpr = triggerInput ? helpers.buildInputExpression(triggerInput) : null;
      const scaleExpr = helpers.parameterRef(scaleControl.index);
      const timeExpr = helpers.parameterRef(timeControl.index);

      const monitorIndexLiteral = scopeMonitorIndex.toString();
      const bodyLines: string[] = [];
      bodyLines.push("if (step == OVERSAMPLING - 1) {");
      bodyLines.push("  const monitorIndex: i32 = " + monitorIndexLiteral + ";");
      bodyLines.push("  let signalSample: f32 = " + signalExpr + ";");
      bodyLines.push("  let scopeScale: f32 = " + scaleExpr + ";");
      bodyLines.push(`  if (scopeScale < ${MIN_SCALE}) scopeScale = ${MIN_SCALE};`);
      bodyLines.push(`  if (scopeScale > ${MAX_SCALE}) scopeScale = ${MAX_SCALE};`);
      bodyLines.push("  let scopeTime: f32 = " + timeExpr + ";");
      bodyLines.push(`  if (scopeTime < ${MIN_TIME}) scopeTime = ${MIN_TIME};`);
      bodyLines.push(`  if (scopeTime > ${MAX_TIME}) scopeTime = ${MAX_TIME};`);
      bodyLines.push("  let targetSamples: i32 = Mathf.round(scopeTime * SAMPLE_RATE) as i32;");
      bodyLines.push("  if (targetSamples < 32) targetSamples = 32;");
      bodyLines.push("  if (targetSamples > SCOPE_MONITOR_CAPACITY) targetSamples = SCOPE_MONITOR_CAPACITY;");
      bodyLines.push("  if (targetSamples < 1) targetSamples = 1;");
      bodyLines.push("  const bufferBase: i32 = monitorIndex * SCOPE_LEVEL_COUNT * SCOPE_MONITOR_CAPACITY;");
      bodyLines.push("  const levelBase: i32 = monitorIndex * SCOPE_LEVEL_COUNT;");
      bodyLines.push("  const metaBase: i32 = monitorIndex * SCOPE_MONITOR_META_STRIDE;");
      bodyLines.push("  let mode: i32 = unchecked(scopeMonitorMode[monitorIndex]);");
      if (triggerExpr) {
        bodyLines.push("  const triggered: bool = " + schmittVar + ".process(" + triggerExpr + ");");
        bodyLines.push("  if (triggered) {");
        bodyLines.push("    mode = 1;");
        bodyLines.push("    for (let level = 0; level < SCOPE_LEVEL_COUNT; level++) {");
        bodyLines.push("      const levelOffset: i32 = levelBase + level;");
        bodyLines.push("      unchecked(scopeMonitorWriteIndex[levelOffset] = 0);");
        bodyLines.push("      unchecked(scopeMonitorCaptured[levelOffset] = 0);");
        bodyLines.push("      unchecked(scopeMonitorDownsample[levelOffset] = 0);");
        bodyLines.push("    }");
        bodyLines.push("  }");
      } else {
        bodyLines.push("  mode = 0;");
      }
      bodyLines.push("  let allCaptured: bool = mode == 1;");
      bodyLines.push("  for (let level = 0; level < SCOPE_LEVEL_COUNT; level++) {");
      bodyLines.push("    const factor: i32 = unchecked(SCOPE_LEVEL_FACTORS[level]);");
      bodyLines.push("    const levelBufferBase: i32 = bufferBase + level * SCOPE_MONITOR_CAPACITY;");
      bodyLines.push("    const levelOffset: i32 = levelBase + level;");
      bodyLines.push("    const metaOffset: i32 = metaBase + level * 3;");
      bodyLines.push("    let levelTarget: i32 = targetSamples;");
      bodyLines.push("    if (levelTarget < 1) levelTarget = 1;");
      bodyLines.push("    let writeIndex: i32 = unchecked(scopeMonitorWriteIndex[levelOffset]);");
      bodyLines.push("    let capturedCount: i32 = unchecked(scopeMonitorCaptured[levelOffset]);");
      bodyLines.push("    let downsample: i32 = unchecked(scopeMonitorDownsample[levelOffset]);");
      bodyLines.push("    let shouldWrite: bool = false;");
      bodyLines.push("    downsample += 1;");
      bodyLines.push("    if (downsample >= factor) {");
      bodyLines.push("      downsample = 0;");
      bodyLines.push("      if (mode == 0) {");
      bodyLines.push("        shouldWrite = true;");
      bodyLines.push("      } else if (mode == 1 && capturedCount < levelTarget) {");
      bodyLines.push("        shouldWrite = true;");
      bodyLines.push("      }");
      bodyLines.push("    }");
      bodyLines.push("    if (shouldWrite) {");
      bodyLines.push("      if (mode == 0) {");
      bodyLines.push("        if (writeIndex >= levelTarget) writeIndex = writeIndex % levelTarget;");
      bodyLines.push("        unchecked(scopeMonitorBuffers[levelBufferBase + writeIndex] = signalSample);");
      bodyLines.push("        writeIndex = (writeIndex + 1) % levelTarget;");
      bodyLines.push("        if (capturedCount < levelTarget) {");
      bodyLines.push("          capturedCount += 1;");
      bodyLines.push("          if (capturedCount > levelTarget) capturedCount = levelTarget;");
      bodyLines.push("        }");
      bodyLines.push("      } else if (mode == 1) {");
      bodyLines.push("        if (writeIndex >= levelTarget) writeIndex = levelTarget - 1;");
      bodyLines.push("        unchecked(scopeMonitorBuffers[levelBufferBase + writeIndex] = signalSample);");
      bodyLines.push("        if (writeIndex < levelTarget - 1) {");
      bodyLines.push("          writeIndex += 1;");
      bodyLines.push("        }");
      bodyLines.push("        if (capturedCount < levelTarget) {");
      bodyLines.push("          capturedCount += 1;");
      bodyLines.push("          if (capturedCount > levelTarget) capturedCount = levelTarget;");
      bodyLines.push("        }");
      bodyLines.push("      }");
      bodyLines.push("    }");
      bodyLines.push("    if (mode == 1 && capturedCount < levelTarget) {");
      bodyLines.push("      allCaptured = false;");
      bodyLines.push("    }");
      bodyLines.push("    unchecked(scopeMonitorWriteIndex[levelOffset] = writeIndex);");
      bodyLines.push("    unchecked(scopeMonitorCaptured[levelOffset] = capturedCount);");
      bodyLines.push("    unchecked(scopeMonitorDownsample[levelOffset] = downsample);");
      bodyLines.push("    unchecked(scopeMonitorMeta[metaOffset + 0] = <f32>levelTarget);");
      bodyLines.push("    unchecked(scopeMonitorMeta[metaOffset + 1] = <f32>writeIndex);");
      bodyLines.push("    unchecked(scopeMonitorMeta[metaOffset + 2] = <f32>capturedCount);");
      bodyLines.push("  }");
      bodyLines.push("  if (mode == 1 && allCaptured) {");
      bodyLines.push("    mode = 2;");
      bodyLines.push("  }");
      bodyLines.push("  const metaTail: i32 = metaBase + SCOPE_LEVEL_COUNT * 3;");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaTail + 0] = scopeScale);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaTail + 1] = scopeTime);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaTail + 2] = <f32>mode);");
      bodyLines.push("  unchecked(scopeMonitorMode[monitorIndex] = mode);");
      bodyLines.push("}");
      const lines = [
        `// ${planNode.node.label} (${planNode.node.id})`,
        "{",
        helpers.indentLines(bodyLines.join("\n"), 1),
        "}"
      ];

      return lines.join("\n");
    }
  }
};
