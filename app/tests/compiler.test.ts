import { describe, expect, it } from "vitest";
import { compilePatch } from "@compiler/compiler";
import { createGraph, addNode, connectNodes } from "@graph/graph";
import { instantiateNode } from "@dsp/nodes";

describe("compiler", () => {
  it("produces a wasm binary for a simple oversampled patch", async () => {
    let graph = createGraph({ oversampling: 4 });
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("class Downsampler");
    expect(result.moduleSource).toContain("INV_SAMPLE_RATE_OVERSAMPLED");
  });

  it("produces a wasm binary for the clock node", async () => {
    let graph = createGraph({ oversampling: 2 });
    const clock = instantiateNode("clock.basic", "clock1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, clock);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: clock.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: clock.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("clock_phase_clock1");
  });

  it("produces a wasm binary for the biquad node", async () => {
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("const biquad_flt1 = new BiquadState()");
  });
});
