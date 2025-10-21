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

  it("emits waveguide delay node with interpolation", () => {
    let graph = createGraph({ oversampling: 2 });
    const osc = instantiateNode("osc.sine", "osc1");
    const mod = instantiateNode("osc.sine", "mod1");
    const delay = instantiateNode("delay.waveguide", "wg1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, mod);
    graph = addNode(graph, delay);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: delay.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: mod.id,
      fromPortId: "out",
      toNodeId: delay.id,
      toPortId: "delay"
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
    expect(source).toContain("const waveguide_wg1 = new WaveguideDelay();");
    expect(source).toContain("const waveguide_wg1_prefetch: f32 = waveguide_wg1.prepare();");
    expect(source).toMatch(/waveguide_wg1\.commit/);
    expect(source).toContain("WAVEGUIDE_MIN_DELAY_UI");
    expect(source).toContain("WAVEGUIDE_MIN_INTERNAL_DELAY");
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
    expect(source).toMatch(/const uniformSample: f32 = \(noise_rng_noise1\.uniform\(\) \* 10\.0\) - 5\.0;/);
    expect(source).toMatch(/let normalSample: f32 = 0.0;/);
    expect(source).toMatch(/if \(noise_hasSpare_noise1\)/);
  });

  it("emits logic AND gate wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const andGate = instantiateNode("logic.and", "and1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, andGate);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: andGate.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: andGate.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: andGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: andGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// AND Gate (and1)");
    expect(source).toMatch(/const valueA: f32 = wire\d+;/);
    expect(source).toMatch(/const valueB: f32 = wire\d+;/);
    expect(source).toContain("let result: f32 = 0.0;");
    expect(source).toContain("if (valueA >= 1.0 && valueB >= 1.0) {");
    expect(source).toContain("result = 5.0;");
  });

  it("emits logic OR gate wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const orGate = instantiateNode("logic.or", "or1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, orGate);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: orGate.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: orGate.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: orGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: orGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// OR Gate (or1)");
    expect(source).toMatch(/const valueA: f32 = wire\d+;/);
    expect(source).toMatch(/const valueB: f32 = wire\d+;/);
    expect(source).toContain("if (valueA >= 1.0 || valueB >= 1.0) {");
    expect(source).toContain("result = 5.0;");
  });

  it("emits logic NOT gate wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const notGate = instantiateNode("logic.not", "not1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, notGate);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: notGate.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: notGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// NOT Gate (not1)");
    expect(source).toMatch(/const inputValue: f32 = wire\d+;/);
    expect(source).toContain("const isFalse: bool = inputValue < 1.0;");
    expect(source).toContain("const result: f32 = isFalse ? 5.0 : 0.0;");
  });

  it("emits logic XOR gate wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const xorGate = instantiateNode("logic.xor", "xor1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, xorGate);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: xorGate.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: xorGate.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: xorGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: xorGate.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// XOR Gate (xor1)");
    expect(source).toContain("const aTrue: bool = valueA >= 1.0;");
    expect(source).toContain("const bTrue: bool = valueB >= 1.0;");
    expect(source).toContain("const isExclusive: bool = (aTrue && !bTrue) || (!aTrue && bTrue);");
    expect(source).toContain("const result: f32 = isExclusive ? 5.0 : 0.0;");
  });

  it("emits slew limiter node wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const slew = instantiateNode("utility.slew", "slew1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, slew);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: slew.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: slew.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: slew.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const slew_slew1 = new SlewLimiter();");
    expect(source).toContain("// Slew Limiter (slew1)");
    expect(source).toMatch(/slew_slew1\.step/);
    expect(source).toMatch(/riseSeconds: f32 = getParameterValue/);
    expect(source).toMatch(/fallSeconds: f32 = getParameterValue/);
    expect(source).toMatch(/shape: f32 = getParameterValue/);
  });

  it("emits soft clip node wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const softclip = instantiateNode("distortion.softclip", "clip1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, softclip);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: softclip.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: softclip.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: softclip.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const shaped: f32 = softclipSample(");
    expect(source).toContain("// Soft Clip (clip1)");
    expect(source).toMatch(/getParameterValue\(\d+\), getParameterValue\(\d+\)\)/);
    expect(source).toContain("softclipSample(rawSample");
  });

  it("emits rectifier node wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const rectifier = instantiateNode("distortion.rectifier", "rect1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, rectifier);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: rectifier.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: rectifier.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// Rectifier (rect1)");
    expect(source).toContain("const rectified: f32 = Mathf.abs(");
    expect(source).toMatch(/wire\d+ = rectified;/);
  });

  it("emits math add node wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const add = instantiateNode("math.add", "add1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, add);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: add.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: add.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: add.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// Add (add1)");
    expect(source).toContain("const result: f32 =");
    expect(source).toMatch(/wire\d+ = result;/);
  });

  it("emits math subtract node wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const subtract = instantiateNode("math.subtract", "sub1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, subtract);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: subtract.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: subtract.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: subtract.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// Subtract (sub1)");
    expect(source).toContain("const result: f32 =");
    expect(source).toMatch(/wire\d+ = result;/);
    expect(source).toContain("-");
  });

  it("emits math multiply node wiring", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const multiply = instantiateNode("math.multiply", "mul1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, multiply);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: multiply.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: multiply.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: multiply.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("// Multiply (mul1)");
    expect(source).toContain("const result: f32 =");
    expect(source).toMatch(/wire\d+ = result;/);
    expect(source).toContain("*");
  });

  it("emits dc bias removal node wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const dc = instantiateNode("utility.dcbias", "dc1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, dc);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: dc.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: dc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const dcblock_dc1 = new DcBlocker();");
    expect(source).toContain("const dcSample: f32 = dcblock_dc1.process(inputSample);");
  });

  it("emits multiplexer node wiring", () => {
    let graph = createGraph();
    const sigA = instantiateNode("osc.sine", "sigA");
    const sigB = instantiateNode("osc.sine", "sigB");
    const sel = instantiateNode("utility.gain", "sel1");
    sel.parameters.gain = 0;
    const mux = instantiateNode("utility.mux", "mux1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, sigA);
    graph = addNode(graph, sigB);
    graph = addNode(graph, sel);
    graph = addNode(graph, mux);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: sigA.id,
      fromPortId: "out",
      toNodeId: mux.id,
      toPortId: "a"
    });

    graph = connectNodes(graph, {
      fromNodeId: sigB.id,
      fromPortId: "out",
      toNodeId: mux.id,
      toPortId: "b"
    });

    graph = connectNodes(graph, {
      fromNodeId: sel.id,
      fromPortId: "out",
      toNodeId: mux.id,
      toPortId: "sel"
    });

    graph = connectNodes(graph, {
      fromNodeId: mux.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const muxOut: f32 = sel < 0.5 ? (");
  });

  it("emits demultiplexer node wiring", () => {
    let graph = createGraph();
    const signal = instantiateNode("osc.sine", "sig1");
    const sel = instantiateNode("utility.gain", "sel1");
    sel.parameters.gain = 0;
    const demux = instantiateNode("utility.demux", "dm1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, signal);
    graph = addNode(graph, sel);
    graph = addNode(graph, demux);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: signal.id,
      fromPortId: "out",
      toNodeId: demux.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: sel.id,
      fromPortId: "out",
      toNodeId: demux.id,
      toPortId: "sel"
    });

    graph = connectNodes(graph, {
      fromNodeId: demux.id,
      fromPortId: "outA",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: demux.id,
      fromPortId: "outB",
      toNodeId: out.id,
      toPortId: "right"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const demuxA: f32 = isB ? 0.0 : signal;");
    expect(source).toContain("const demuxB: f32 = isB ? signal : 0.0;");
  });

  it("emits sample and hold wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "sig1");
    const trig = instantiateNode("clock.basic", "clk1");
    const snh = instantiateNode("utility.samplehold", "snh1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, trig);
    graph = addNode(graph, snh);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: snh.id,
      toPortId: "signal"
    });

    graph = connectNodes(graph, {
      fromNodeId: trig.id,
      fromPortId: "out",
      toNodeId: snh.id,
      toPortId: "trigger"
    });

    graph = connectNodes(graph, {
      fromNodeId: snh.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const { source } = emitAssemblyScript(graph);
    expect(source).toContain("const isTrigger: bool = snh_trig_snh1.process(trigSample);");
    expect(source).toContain("if (isTrigger) { snh_state_snh1 =");
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

  it("emits oscilloscope monitor wiring", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const scope = instantiateNode("utility.scope", "scope1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, scope);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: scope.id,
      toPortId: "signal"
    });

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
    expect(source).toContain("const SCOPE_MONITOR_COUNT");
    expect(source).toContain("const SCOPE_LEVEL_COUNT");
    expect(source).toContain("scopeMonitorDownsample");
    expect(source).toMatch(/const monitorIndex: i32/);
  });
});
