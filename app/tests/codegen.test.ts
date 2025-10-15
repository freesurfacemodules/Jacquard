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

    const source = emitAssemblyScript(graph);

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

    const source = emitAssemblyScript(graph);

    expect(source).toContain("let auto_out_left: f32 = 0.0;");
    expect(source).toContain("let auto_out_right: f32 = 0.0;");
    expect(source).toMatch(/auto_out_left = sample;/);
    expect(source).toMatch(/auto_out_right = sample;/);
    expect(source).toContain("let outLeft: f32 = auto_out_left;");
    expect(source).toContain("let outRight: f32 = auto_out_right;");
  });
});
