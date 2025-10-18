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
    expect(result.envelopeMonitors.length).toBe(0);
    expect(result.scopeMonitors.length).toBe(0);
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
    expect(result.moduleSource).toContain("const biquad_low_flt1 = new BiquadState()");
    expect(result.moduleSource).toContain("const biquad_high_flt1 = new BiquadState()");
  });

  it("produces a wasm binary for the noise node", async () => {
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("const noise_rng_noise1 = new Xoroshiro128Plus");
    expect(result.envelopeMonitors.length).toBe(0);
    expect(result.scopeMonitors.length).toBe(0);
  });

  it("produces a wasm binary for the soft clip node", async () => {
    let graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const softclip = instantiateNode("utility.softclip", "clip1");
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("Soft Clip (clip1)");
    expect(result.moduleSource).toContain("softclipSample(rawSample");
  });

  it("produces a wasm binary for the slew limiter node", async () => {
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("Slew Limiter (slew1)");
    expect(result.moduleSource).toContain("slew_slew1 = new SlewLimiter()");
  });

  it("produces a wasm binary for the AD envelope node", async () => {
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("class SchmittTrigger");
    expect(result.moduleSource).toContain("class AdEnvelope");
    expect(result.envelopeMonitors.length).toBe(1);
    expect(result.envelopeMonitors[0]).toMatchObject({ nodeId: "env1", index: 0 });
    expect(result.scopeMonitors.length).toBe(0);
  });

  it("produces a wasm binary for the oscilloscope node", async () => {
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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("const scopeMonitorDownsample");
    expect(result.scopeMonitors.length).toBe(1);
    expect(result.scopeMonitors[0]).toMatchObject({ nodeId: "scope1", index: 0 });
    expect(result.scopeMonitors[0].levelCount).toBe(4);
    expect(result.scopeMonitors[0].levelFactors).toEqual([1, 2, 4, 8]);
  });

  it("produces a wasm binary for the ladder filter node", async () => {
    let graph = createGraph({ oversampling: 2 });
    const osc = instantiateNode("osc.sine", "osc1");
    const ladder = instantiateNode("filter.ladder", "lad1");
    const out = instantiateNode("io.output", "out1");

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

    const result = await compilePatch(graph);
    expect(result.wasmBinary.byteLength).toBeGreaterThan(0);
    expect(result.moduleSource).toContain("const ladder_lad1 = new LadderFilter()");
    expect(result.moduleSource).toContain("ladder_rng_lad1 = new Xoroshiro128Plus");
  });
});
