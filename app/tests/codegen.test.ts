import { describe, expect, it } from "vitest";
import { createGraph, addNode, connectNodes } from "@graph/graph";
import { instantiateNode } from "@dsp/nodes";
import { emitAssemblyScript } from "@codegen/assemblyscript";

describe("code generation", () => {
  it("emits AssemblyScript for a sine -> output patch", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);

    expect(source).toContain("class SineOsc");
    expect(source).toContain("node_osc1.step");
    expect(source).toContain("pushOutputSamples(outLeft, outRight)");
    expect(source).toContain("INV_SAMPLE_RATE_OVERSAMPLED");
  });

  it("throws when graph validation fails", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    graph = addNode(graph, osc);

    expect(() => emitAssemblyScript(graph)).toThrow(/Graph validation failed/);
  });

  it("skips oscillator output when not connected", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, out);

    const { source } = emitAssemblyScript(graph);

    expect(source).toContain("// Sine Oscillator (osc1) has no outgoing connections.");
  });

  it("emits stereo mixer node wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const mixer = instantiateNode("mixer.stereo", "mix1");
    const out = instantiateNode("io.output", "out1");

    mixer.parameters.pan_ch1 = -0.25;
    mixer.parameters.gain_ch1 = 0.5;

    graph = addNode(graph, osc);
    graph = addNode(graph, mixer);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: mixer.id,
      toPortId: "ch1"
    });

    graph = connectNodes(graph, {
      fromNodeId: mixer.id,
      fromPortId: "left",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: mixer.id,
      fromPortId: "right",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);

    expect(source).toContain("Stereo Mixer (mix1)");
    expect(source).toMatch(/let mix_mix1_left: f32 = 0.0;/);
    expect(source).toMatch(/let mix_mix1_right: f32 = 0.0;/);
    expect(source).toMatch(/gain_ch1: f32 = 0.5/);
    expect(source).toMatch(/pan_ch1: f32 = -0.25/);
    expect(source).toMatch(/mix_mix1_left \+=/);
    expect(source).toMatch(/mix_mix1_right \+=/);
    expect(source).toMatch(/wire\d+ = mix_mix1_left;/);
    expect(source).toMatch(/wire\d+ = mix_mix1_right;/);
  });

  it("emits gain node with parameter fallback", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const gain = instantiateNode("utility.gain", "gain1");
    gain.parameters.gain = 2.5;
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, gain);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: gain.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: gain.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: gain.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// Gain (gain1)");
    expect(source).toMatch(/scaled: f32 = \(wire\d+\) \* \(getParameterValue\(0\)\)/);
  });

  it("emits delay node with oversampling-aware logic", () => {
    let graph = createGraph({ oversampling: 4 });
    const osc = instantiateNode("osc.sine", "osc1");
    const delay = instantiateNode("delay.ddl", "delay1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, delay);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: delay.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: delay.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: delay.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const delay_delay1 = new DdlDelay();");
    expect(source).toMatch(/const delay_delay1_prefetch: f32 = delay_delay1\.prepare\(\);/);
    expect(source).toMatch(/delay_delay1\.commit\(inputSample, internalSamples\);/);
    expect(source).toContain("const MIN_DELAY_SAMPLES");
  });

  it("emits biquad filter wiring", () => {
    let graph = createGraph({ oversampling: 2 });
    const osc = instantiateNode("osc.sine", "osc1");
    const biquad = instantiateNode("filter.biquad", "flt1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, biquad);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: biquad.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: biquad.id,
      fromPortId: "low",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: biquad.id,
      fromPortId: "high",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const biquad_low_flt1 = new BiquadState();");
    expect(source).toContain("const biquad_high_flt1 = new BiquadState();");
    expect(source).toMatch(/biquad_low_flt1\.updateCoefficients/);
    expect(source).toMatch(/biquad_high_flt1\.process/);
  });

  it("emits noise node outputs", () => {
    let graph = createGraph();
    const noise = instantiateNode("noise.basic", "noise1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, noise);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: noise.id,
      fromPortId: "uniform",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: noise.id,
      fromPortId: "normal",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const noise_rng_noise1 = new Xoroshiro128Plus");
    expect(source).toMatch(/const uniformSample: f32 = noise_rng_noise1\.uniform/);
    expect(source).toMatch(/let normalSample: f32 = 0.0;/);
    expect(source).toMatch(/if \(noise_hasSpare_noise1\)/);
  });

  it("emits AD envelope node wiring", () => {
    let graph = createGraph();
    const envelope = instantiateNode("envelope.ad", "env1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, envelope);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: envelope.id,
      fromPortId: "envelope",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: envelope.id,
      fromPortId: "envelope",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("class SchmittTrigger");
    expect(source).toContain("class AdEnvelope");
    expect(source).toContain("setEnvelopeMonitor(");
    expect(source).toMatch(/const schmitt_env1 = new SchmittTrigger/);
    expect(source).toMatch(/env_env1\.start/);
    expect(source).toMatch(/const envelopeValue: f32 = env_env1\.step\(\);/);
    expect(source).toMatch(/setEnvelopeMonitor\(0, envelopeValue, env_env1\.getProgress\(\)\);/);
  });

  it("emits ladder filter node wiring", () => {
    let graph = createGraph({ oversampling: 2 });
    const osc = instantiateNode("osc.sine", "osc1");
    const ladder = instantiateNode("filter.ladder", "lad1");
    const out = instantiateNode("io.output", "out1");

    ladder.parameters.frequency = 800;
    ladder.parameters.resonance = 0.6;
    ladder.parameters.drive = 0.25;

    graph = addNode(graph, osc);
    graph = addNode(graph, ladder);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: ladder.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: ladder.id,
      fromPortId: "lowpass",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: ladder.id,
      fromPortId: "highpass",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const ladder_lad1 = new LadderFilter();");
    expect(source).toContain("// Ladder Filter (lad1)");
    expect(source).toMatch(/ladder_lad1\.process\(inputSample\)/);
    expect(source).toMatch(/ladder_rng_lad1\.uniform/);
    expect(source).toMatch(/cutoffHz \*= Mathf\.pow\(2\.0, pitchOffset\);/);
    expect(source).toMatch(/const lowpassSample: f32 = ladder_lad1\.lowpass/);
    expect(source).toMatch(/const highpassSample: f32 = ladder_lad1\.highpass/);
  });
});
