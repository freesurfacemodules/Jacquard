import { describe, expect, it } from "vitest";
import {
  createGraph,
  addNode,
  connectNodes,
  removeConnection,
  removeConnectionsFromPort,
  removeConnectionsToPort,
  removeNode,
  updatePatchSettings,
  updateNodePosition,
  updateNodeParameter
} from "@graph/graph";
import { validateGraph } from "@graph/validation";
import { instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";

describe("graph", () => {
  it("creates an empty graph with sane defaults", () => {
    const graph = createGraph();
    expect(graph.nodes).toHaveLength(0);
    expect(graph.connections).toHaveLength(0);
    expect(graph.sampleRate).toBe(48_000);
    expect(graph.blockSize).toBe(128);
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

  it("prevents duplicate connections", () => {
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

    expect(() =>
      connectNodes(graph, {
        fromNodeId: osc.id,
        fromPortId: "out",
        toNodeId: out.id,
        toPortId: "left"
      })
    ).toThrow(/Duplicate connection/);
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

  it("updates node position immutably", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const graph = addNode(createGraph(), osc);
    const updated = updateNodePosition(graph, osc.id, { x: 120, y: 200 });

    expect(graph.nodes[0].metadata?.position).toBeUndefined();
    expect(updated.nodes[0].metadata?.position).toEqual({ x: 120, y: 200 });
  });

  it("removes connections without mutating the original graph", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    const graphWithNodes = addNode(addNode(createGraph(), osc), out);
    const graphWithConnection = connectNodes(graphWithNodes, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const connectionId = graphWithConnection.connections[0].id;
    const trimmed = removeConnection(graphWithConnection, connectionId);

    expect(graphWithConnection.connections).toHaveLength(1);
    expect(trimmed.connections).toHaveLength(0);
  });

  it("removes nodes and their connections immutably", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const out = instantiateNode("io.output", "out1");

    let graph = createGraph();
    graph = addNode(graph, osc);
    graph = addNode(graph, out);
    graph = connectNodes(graph, {
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const updated = removeNode(graph, osc.id);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.connections).toHaveLength(1);
    expect(updated.nodes.map((node) => node.id)).toEqual(["out1"]);
    expect(updated.connections).toHaveLength(0);
  });

  it("removes connections from a specific output port", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const mixer = instantiateNode("mixer.stereo", "mix1");
    const out = instantiateNode("io.output", "out1");

    let graph = createGraph();
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
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "left"
    });

    const pruned = removeConnectionsFromPort(graph, osc.id, "out");

    expect(pruned.connections).toHaveLength(0);
    expect(graph.connections).toHaveLength(2);
  });

  it("removes connections targeting a specific input port", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const gain = instantiateNode("utility.gain", "gain1");
    const out = instantiateNode("io.output", "out1");

    let graph = createGraph();
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
      fromNodeId: osc.id,
      fromPortId: "out",
      toNodeId: out.id,
      toPortId: "right"
    });

    const pruned = removeConnectionsToPort(graph, out.id, "right");

    expect(pruned.connections).toHaveLength(2);
    expect(pruned.connections.every((connection) => connection.to.port !== "right")).toBe(
      true
    );
  });

  it("updates patch settings immutably", () => {
    const graph = createGraph();
    const updated = updatePatchSettings(graph, {
      sampleRate: 96_000,
      blockSize: 256,
      oversampling: 4
    });

    expect(graph.sampleRate).toBe(48_000);
    expect(graph.blockSize).toBe(128);
    expect(graph.oversampling).toBe(1);

    expect(updated.sampleRate).toBe(96_000);
    expect(updated.blockSize).toBe(256);
    expect(updated.oversampling).toBe(4);
  });

  it("rejects invalid patch settings", () => {
    const graph = createGraph();
    expect(() => updatePatchSettings(graph, { sampleRate: -1 })).toThrow(/Invalid sample rate/);
    expect(() => updatePatchSettings(graph, { blockSize: 64 as 128 })).toThrow(/Invalid block size/);
    expect(() => updatePatchSettings(graph, { oversampling: 3 as 1 })).toThrow(/Invalid oversampling/);
  });

  it("allows feedback loops when delayed", () => {
    let graph = createGraph();
    const gain = instantiateNode("utility.gain", "gain1");
    const delay = instantiateNode("delay.ddl", "delay1");
    const out = instantiateNode("io.output", "out1");

    graph = addNode(graph, gain);
    graph = addNode(graph, delay);
    graph = addNode(graph, out);

    graph = connectNodes(graph, {
      fromNodeId: gain.id,
      fromPortId: "out",
      toNodeId: delay.id,
      toPortId: "in"
    });

    graph = connectNodes(graph, {
      fromNodeId: delay.id,
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

    const validation = validateGraph(graph);
    expect(validation.isValid).toBe(true);
  });

  it("updates node parameters immutably", () => {
    const osc = instantiateNode("osc.sine", "osc1");
    const graph = addNode(createGraph(), osc);
    const updated = updateNodeParameter(graph, osc.id, "pitch", 0.5);

    expect(graph.nodes[0].parameters.pitch).toBe(0);
    expect(updated.nodes[0].parameters.pitch).toBe(0.5);
  });
});
