import { describe, expect, it } from "vitest";
import { createGraph, addNode, connectNodes } from "@graph/graph";
import { validateGraph } from "@graph/validation";
import { instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";

describe("graph", () => {
  it("creates an empty graph with sane defaults", () => {
    const graph = createGraph();
    expect(graph.nodes).toHaveLength(0);
    expect(graph.connections).toHaveLength(0);
    expect(graph.sampleRate).toBe(48_000);
    expect(graph.blockSize).toBe(256);
    expect(graph.oversampling).toBe(1);
  });

  it("adds nodes immutably", () => {
    const graph = createGraph();
    const node = instantiateNode("osc.sine", nanoid());
    const updated = addNode(graph, node);
    expect(graph.nodes).toHaveLength(0);
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0]).toMatchObject({ kind: "osc.sine" });
  });

  it("connects nodes with type validation", () => {
    const graph = createGraph();
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    const withOsc = addNode(graph, osc);
    const withOut = addNode(withOsc, out);

    const connected = connectNodes(withOut, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    expect(connected.connections).toHaveLength(1);
    expect(connected.connections[0]).toMatchObject({
      from: { node: "osc1", port: "out" },
      to: { node: "out1", port: "left" }
    });
  });

  it("validates acyclic graphs", () => {
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

    const result = validateGraph(graph);
    expect(result.isValid).toBe(true);
    expect(result.order.map((node) => node.id)).toEqual(["osc1", "out1"]);
  });

  it("detects cycles", () => {
    let graph = createGraph();
    const oscA = instantiateNode("osc.sine", "oscA");
    const oscB = instantiateNode("osc.sine", "oscB");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, oscA);
    graph = addNode(graph, oscB);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: oscB.id,
      toPortId: "pitch"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: oscA.id,
      toPortId: "pitch"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscA.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    graph = connectNodes(graph, {
      fromNodeId: oscB.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const result = validateGraph(graph);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "CYCLE_DETECTED")).toBe(
      true
    );
  });
});
