import { audioPort } from "../../common";
import type { NodeImplementation } from "@dsp/types";
import schmittTriggerSource from "@dsp/snippets/schmitt-trigger.as?raw";

const TRIGGER_INPUT = "trigger";
const SEED_INPUT = "seedIn";
const RESEED_INPUT = "reseed";
const VALUE_OUTPUT = "value";
const SEED_CONTROL = "seed";

const SEED_MIN = 0.0;
const SEED_MAX = 9999.0;
const SEED_INPUT_SCALE = 2000.0;

export const seededRandomNode: NodeImplementation = {
  manifest: {
    kind: "random.seeded",
    category: "random",
    label: "Seeded Random",
    inputs: [
      audioPort(TRIGGER_INPUT, "Trigger"),
      audioPort(SEED_INPUT, "Seed CV"),
      audioPort(RESEED_INPUT, "Reseed")
    ],
    outputs: [audioPort(VALUE_OUTPUT, "Value")],
    defaultParams: {
      [SEED_CONTROL]: 0
    },
    appearance: {
      width: 240,
      height: 180,
      icon: "dice"
    },
    controls: [
      {
        id: SEED_CONTROL,
        label: "Seed",
        type: "slider",
        min: SEED_MIN,
        max: SEED_MAX,
        step: 1
      }
    ]
  },
  assembly: {
    declarations: schmittTriggerSource,
    emit(planNode, helpers) {
      const triggerInput = planNode.inputs.find((entry) => entry.port.id === TRIGGER_INPUT);
      const seedInput = planNode.inputs.find((entry) => entry.port.id === SEED_INPUT);
      const reseedInput = planNode.inputs.find((entry) => entry.port.id === RESEED_INPUT);
      const output = planNode.outputs.find((entry) => entry.port.id === VALUE_OUTPUT);
      const seedControl = planNode.controls.find((entry) => entry.controlId === SEED_CONTROL);

      if (!output || !seedControl || !triggerInput || !reseedInput) {
        return `// ${planNode.node.label} (${planNode.node.id}) missing configuration.`;
      }

      const identifier = helpers.sanitizeIdentifier(planNode.node.id);
      const triggerVar = `seeded_trigger_${identifier}`;
      const reseedVar = `seeded_reseed_${identifier}`;
      const rngVar = `seeded_rng_${identifier}`;
      const seedStateVar = `seeded_seed_${identifier}`;
      const initializedVar = `seeded_initialized_${identifier}`;
      const valueVar = `seeded_value_${identifier}`;

      const triggerExpr = helpers.buildInputExpression(triggerInput);
      const reseedExpr = helpers.buildInputExpression(reseedInput);
      const seedExpr = seedInput ? helpers.buildInputExpression(seedInput) : helpers.numberLiteral(0);
      const seedControlExpr = helpers.parameterRef(seedControl.index);

      const assignments = output.wires
        .map((wire) => `${wire.varName} = ${valueVar};`)
        .join("\n");

      const lines: string[] = [];
      lines.push(`// ${planNode.node.label} (${planNode.node.id})`);
      lines.push("{");

      const body: string[] = [];
      body.push(`let seedControlValue: f32 = ${seedControlExpr};`);
      body.push(`if (seedControlValue < ${SEED_MIN}) seedControlValue = ${SEED_MIN};`);
      body.push(`if (seedControlValue > ${SEED_MAX}) seedControlValue = ${SEED_MAX};`);
      body.push(`let seedInputValue: f32 = ${seedExpr};`);
      body.push("if (seedInputValue < -10.0) seedInputValue = -10.0;");
      body.push("if (seedInputValue > 10.0) seedInputValue = 10.0;");
      body.push(`let combinedSeed: f32 = seedControlValue + (seedInputValue * ${SEED_INPUT_SCALE});`);
      body.push(`if (combinedSeed < ${SEED_MIN}) combinedSeed = ${SEED_MIN};`);
      body.push(`if (combinedSeed > ${SEED_MAX}) combinedSeed = ${SEED_MAX};`);
      body.push("let seedInt: i32 = <i32>Mathf.round(combinedSeed);");
      body.push("if (seedInt < 0) seedInt = 0;");
      body.push("if (seedInt > 9999) seedInt = 9999;");
      body.push(`${seedStateVar} = seedInt;`);

      body.push("let shouldReseed: bool = false;");
      body.push("if (!" + initializedVar + ") {");
      body.push("  shouldReseed = true;");
      body.push("}");
      body.push(`const reseedSample: f32 = ${reseedExpr};`);
      body.push(`if (${reseedVar}.process(reseedSample)) {`);
      body.push("  shouldReseed = true;");
      body.push("}");
      body.push("if (shouldReseed) {");
      body.push("  let seedScalar: u64 = <u64>(seedInt + 1);");
      body.push("  const seed0: u64 = 0x9E3779B97F4A7C15 ^ (seedScalar | 1);");
      body.push("  const seed1: u64 = 0xD1B54A32D192ED03 ^ ((seedScalar << 1) | 1);");
      body.push(`  ${rngVar}.seed(seed0, seed1);`);
      body.push(`  ${initializedVar} = true;`);
      body.push("}");

      body.push(`const triggerSample: f32 = ${triggerExpr};`);
      body.push(`if (${triggerVar}.process(triggerSample)) {`);
      body.push(`  ${valueVar} = ${rngVar}.uniform() * 10.0;`);
      body.push("}");

      lines.push(helpers.indentLines(body.join("\n"), 1));

      if (assignments) {
        lines.push(helpers.indentLines(assignments, 1));
      }

      lines.push("}");

      return lines.join("\n");
    }
  }
};

export default seededRandomNode;
