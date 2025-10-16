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
    expect(source).toContain("store<f32>(ptrL");
    expect(source).toContain("store<f32>(ptrR");
  });

  it("throws when graph validation fails", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    graph = addNode(graph, osc);

    expect(() => emitAssemblyScript(graph)).toThrow(/Graph validation failed/);
  });

  it("auto routes an unconnected oscillator to both output channels", () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, osc);
    graph = addNode(graph, out);

    const { source } = emitAssemblyScript(graph);

    expect(source).toContain("let auto_out_left: f32 = 0.0;");
    expect(source).toContain("let auto_out_right: f32 = 0.0;");
    expect(source).toMatch(/auto_out_left = sample;/);
    expect(source).toMatch(/auto_out_right = sample;/);
    expect(source).toContain("let outLeft: f32 = auto_out_left;");
    expect(source).toContain("let outRight: f32 = auto_out_right;");
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
});
