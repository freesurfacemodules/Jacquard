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

      const bufferBase = scopeMonitorIndex;
      const bufferOffsetExpr = `${bufferBase} * SCOPE_MONITOR_CAPACITY`;
      const metaOffsetExpr = `${bufferBase} * SCOPE_MONITOR_META_STRIDE`;

      const monitorIndexLiteral = scopeMonitorIndex.toString();
      const bodyLines: string[] = [];
      bodyLines.push("if (step == OVERSAMPLING - 1) {");
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
      bodyLines.push("  const bufferBase: i32 = " + bufferOffsetExpr + ";");
      bodyLines.push("  const metaBase: i32 = " + metaOffsetExpr + ";");
      bodyLines.push("  let writeIndex: i32 = unchecked(scopeMonitorWriteIndex[" + monitorIndexLiteral + "]);" );
      bodyLines.push("  let captured: i32 = unchecked(scopeMonitorCaptured[" + monitorIndexLiteral + "]);" );
      bodyLines.push("  let mode: i32 = unchecked(scopeMonitorMode[" + monitorIndexLiteral + "]);" );
      if (triggerExpr) {
        bodyLines.push("  if (" + schmittVar + ".process(" + triggerExpr + ")) {");
        bodyLines.push("    writeIndex = 0;");
        bodyLines.push("    captured = 0;");
        bodyLines.push("    mode = 1;");
        bodyLines.push("  } else {");
        bodyLines.push("    mode = 1;");
        bodyLines.push("  }");
      } else {
        bodyLines.push("  mode = 0;");
      }
      bodyLines.push("  if (writeIndex >= targetSamples) {");
      bodyLines.push("    if (mode == 0) {");
      bodyLines.push("      writeIndex = 0;");
      bodyLines.push("    } else if (targetSamples > 0) {");
      bodyLines.push("      writeIndex = targetSamples - 1;");
      bodyLines.push("    }");
      bodyLines.push("  }");
      bodyLines.push("  const canCapture: bool = mode == 0 || captured < targetSamples;");
      bodyLines.push("  if (canCapture && targetSamples > 0) {");
      bodyLines.push("    unchecked(scopeMonitorBuffers[bufferBase + writeIndex] = signalSample);");
      bodyLines.push("    if (mode == 0) {");
      bodyLines.push("      writeIndex = (writeIndex + 1) % targetSamples;");
      bodyLines.push("    } else {");
      bodyLines.push("      writeIndex += 1;");
      bodyLines.push("      if (writeIndex >= targetSamples) {");
      bodyLines.push("        writeIndex = targetSamples - 1;");
      bodyLines.push("      }");
      bodyLines.push("    }");
      bodyLines.push("    if (captured < targetSamples) {");
      bodyLines.push("      captured += 1;");
      bodyLines.push("    }");
      bodyLines.push("  }");
      bodyLines.push("  unchecked(scopeMonitorWriteIndex[" + monitorIndexLiteral + "] = writeIndex);");
      bodyLines.push("  unchecked(scopeMonitorCaptured[" + monitorIndexLiteral + "] = captured);");
      bodyLines.push("  unchecked(scopeMonitorMode[" + monitorIndexLiteral + "] = mode);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 0] = <f32>targetSamples);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 1] = <f32>writeIndex);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 2] = scopeScale);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 3] = scopeTime);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 4] = <f32>mode);");
      bodyLines.push("  unchecked(scopeMonitorMeta[metaBase + 5] = <f32>captured);");
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
