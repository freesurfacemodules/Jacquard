import { nanoid } from "@codegen/utils/nanoid";
import {
  Connection,
  NodeDescriptor,
  PatchGraph,
  SubpatchGraph
} from "./types";

interface Endpoint {
  nodeId: string;
  portId: string;
}

const makeScopedId = (path: string[], baseId: string): string => {
  if (path.length === 0) {
    return baseId;
  }
  return `${path.join("__")}__${baseId}`;
};

export function flattenForCodegen(root: PatchGraph): PatchGraph {
  const subpatches = root.subpatches ?? {};

  const cloneNode = (node: NodeDescriptor, idOverride?: string): NodeDescriptor => ({
    id: idOverride ?? node.id,
    kind: node.kind,
    label: node.label,
    inputs: node.inputs.map((port) => ({ ...port })),
    outputs: node.outputs.map((port) => ({ ...port })),
    parameters: { ...(node.parameters ?? {}) },
    metadata: undefined,
    subpatchId: node.subpatchId
  });

  const usedIds = new Set<string>();
  const allocateId = (desired: string): string => {
    let id = desired;
    let counter = 1;
    while (usedIds.has(id)) {
      id = `${desired}__${counter++}`;
    }
    usedIds.add(id);
    return id;
  };

  const nodes: NodeDescriptor[] = root.nodes.map((node) => {
    usedIds.add(node.id);
    return cloneNode(node);
  });

  const connectionSet = new Set<string>();
  const connections: Connection[] = [];
  const addConnection = (fromNode: string, fromPort: string, toNode: string, toPort: string): void => {
    const key = `${fromNode}::${fromPort}=>${toNode}::${toPort}`;
    if (connectionSet.has(key)) {
      return;
    }
    connectionSet.add(key);
    connections.push({
      id: nanoid(),
      from: { node: fromNode, port: fromPort },
      to: { node: toNode, port: toPort }
    });
  };

  for (const conn of root.connections) {
    const key = `${conn.from.node}::${conn.from.port}=>${conn.to.node}::${conn.to.port}`;
    if (!connectionSet.has(key)) {
      connectionSet.add(key);
      connections.push({ ...conn });
    }
  }

  const expandSubpatch = (nodeIndex: number): void => {
    const node = nodes[nodeIndex];
    if (!node.subpatchId) {
      return;
    }
    const entry: SubpatchGraph | undefined = subpatches[node.subpatchId];
    if (!entry) {
      // Remove node and associated edges.
      nodes.splice(nodeIndex, 1);
      const remaining: Connection[] = [];
      connectionSet.clear();
      for (const conn of connections) {
        if (conn.from.node === node.id || conn.to.node === node.id) {
          continue;
        }
        const key = `${conn.from.node}::${conn.from.port}=>${conn.to.node}::${conn.to.port}`;
        connectionSet.add(key);
        remaining.push(conn);
      }
      connections.length = 0;
      connections.push(...remaining);
      return;
    }

    const path = [node.id];
    const idMap = new Map<string, string>();

    for (const inner of entry.graph.nodes) {
      if (inner.id === entry.inputNodeId || inner.id === entry.outputNodeId) {
        continue;
      }
      const scopedId = makeScopedId(path, inner.id);
      const newId = allocateId(scopedId);
      nodes.push(cloneNode(inner, newId));
      idMap.set(inner.id, newId);
    }

    // Remove the subpatch node.
    nodes.splice(nodeIndex, 1);

    // Rebuild connection list excluding edges touching the subpatch node.
    const incomingByPort = new Map<string, Connection[]>();
    const outgoingByPort = new Map<string, Connection[]>();
    const remainingConnections: Connection[] = [];
    connectionSet.clear();

    for (const conn of connections) {
      if (conn.to.node === node.id) {
        const arr = incomingByPort.get(conn.to.port) ?? [];
        arr.push(conn);
        incomingByPort.set(conn.to.port, arr);
        continue;
      }
      if (conn.from.node === node.id) {
        const arr = outgoingByPort.get(conn.from.port) ?? [];
        arr.push(conn);
        outgoingByPort.set(conn.from.port, arr);
        continue;
      }
      remainingConnections.push(conn);
      connectionSet.add(`${conn.from.node}::${conn.from.port}=>${conn.to.node}::${conn.to.port}`);
    }
    connections.length = 0;
    connections.push(...remainingConnections);

    const inputTargets = new Map<string, Endpoint[]>();
    const outputSources = new Map<string, Endpoint[]>();
    const passThrough = new Map<string, string>();

    for (const innerConn of entry.graph.connections) {
      const { from, to } = innerConn;
      if (from.node === entry.inputNodeId && to.node === entry.outputNodeId) {
        passThrough.set(from.port, to.port);
        continue;
      }
      if (from.node === entry.inputNodeId) {
        const mappedTarget = idMap.get(to.node);
        if (mappedTarget) {
          const arr = inputTargets.get(from.port) ?? [];
          arr.push({ nodeId: mappedTarget, portId: to.port });
          inputTargets.set(from.port, arr);
        }
        continue;
      }
      if (to.node === entry.outputNodeId) {
        const mappedSource = idMap.get(from.node);
        if (mappedSource) {
          const arr = outputSources.get(to.port) ?? [];
          arr.push({ nodeId: mappedSource, portId: from.port });
          outputSources.set(to.port, arr);
        }
        continue;
      }
      const mappedFrom = idMap.get(from.node);
      const mappedTo = idMap.get(to.node);
      if (mappedFrom && mappedTo) {
        addConnection(mappedFrom, from.port, mappedTo, to.port);
      }
    }

    for (const [portId, externalConns] of incomingByPort.entries()) {
      const targets = inputTargets.get(portId) ?? [];
      if (targets.length === 0) {
        continue;
      }
      for (const external of externalConns) {
        for (const target of targets) {
          addConnection(external.from.node, external.from.port, target.nodeId, target.portId);
        }
      }
    }

    for (const [portId, externalConns] of outgoingByPort.entries()) {
      const sources = outputSources.get(portId) ?? [];
      if (sources.length === 0) {
        continue;
      }
      for (const external of externalConns) {
        for (const source of sources) {
          addConnection(source.nodeId, source.portId, external.to.node, external.to.port);
        }
      }
    }

    for (const [inputPort, outputPort] of passThrough.entries()) {
      const incoming = incomingByPort.get(inputPort) ?? [];
      const outgoing = outgoingByPort.get(outputPort) ?? [];
      for (const incomingConn of incoming) {
        for (const outgoingConn of outgoing) {
          addConnection(incomingConn.from.node, incomingConn.from.port, outgoingConn.to.node, outgoingConn.to.port);
        }
      }
    }
  };

  while (true) {
    const index = nodes.findIndex((node) => node.kind === "logic.subpatch");
    if (index === -1) {
      break;
    }
    expandSubpatch(index);
  }

  return {
    nodes,
    connections,
    sampleRate: root.sampleRate,
    blockSize: root.blockSize,
    oversampling: root.oversampling,
    subpatches: {},
    rootSubpatchId: root.rootSubpatchId
  };
}
