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

interface SubpatchBridge {
  inputTargets: Map<string, Endpoint[]>;
  outputSources: Map<string, Endpoint[]>;
  passThrough: Map<string, string>;
}

const makeScopedId = (path: string[], baseId: string): string => {
  if (path.length === 0) {
    return baseId;
  }
  return `${path.join("__")}__${baseId}`;
};

export function flattenForCodegen(root: PatchGraph): PatchGraph {
  const flatNodes: NodeDescriptor[] = [];
  const flatConnections: Connection[] = [];
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

  const cloneNode = (node: NodeDescriptor, newId: string): NodeDescriptor => ({
    id: newId,
    kind: node.kind,
    label: node.label,
    inputs: node.inputs.map((port) => ({ ...port })),
    outputs: node.outputs.map((port) => ({ ...port })),
    parameters: { ...(node.parameters ?? {}) },
    metadata: undefined
  });

  const nodeIdMap = new Map<string, string>();
  const subpatchBridges = new Map<string, SubpatchBridge>();
  const subpatches = root.subpatches ?? {};

  // Clone all non-subpatch root nodes first
  const rootKindMap = new Map<string, string>();
  for (const node of root.nodes) {
    rootKindMap.set(node.id, node.kind);
    if (node.kind === "logic.subpatch") {
      continue;
    }
    const newId = allocateId(node.id);
    flatNodes.push(cloneNode(node, newId));
    nodeIdMap.set(node.id, newId);
  }

  // Expand subpatch nodes (no nested subpatch support yet)
  for (const node of root.nodes) {
    if (node.kind !== "logic.subpatch" || !node.subpatchId) {
      continue;
    }
    const entry = subpatches[node.subpatchId];
    if (!entry) {
      continue;
    }

    const basePath = [node.id];
    const idMap = new Map<string, string>();

    for (const inner of entry.graph.nodes) {
      if (inner.id === entry.inputNodeId || inner.id === entry.outputNodeId) {
        continue;
      }
      if (inner.kind === "logic.subpatch") {
        throw new Error("Nested subpatches are not yet supported during compilation.");
      }
      const scopedId = makeScopedId(basePath, inner.id);
      const newId = allocateId(scopedId);
      flatNodes.push(cloneNode(inner, newId));
      idMap.set(inner.id, newId);
    }

    const inputTargets = new Map<string, Endpoint[]>();
    const outputSources = new Map<string, Endpoint[]>();
    const passThrough = new Map<string, string>();

    for (const connection of entry.graph.connections) {
      const { from, to } = connection;
      if (from.node === entry.inputNodeId && to.node === entry.outputNodeId) {
        passThrough.set(from.port, to.port);
        continue;
      }
      if (from.node === entry.inputNodeId) {
        const targetId = idMap.get(to.node);
        if (!targetId) {
          throw new Error("Subpatch references unsupported targets (nested subpatch not expanded).");
        }
        const arr = inputTargets.get(from.port) ?? [];
        arr.push({ nodeId: targetId, portId: to.port });
        inputTargets.set(from.port, arr);
        continue;
      }
      if (to.node === entry.outputNodeId) {
        const sourceId = idMap.get(from.node);
        if (!sourceId) {
          throw new Error("Subpatch references unsupported sources (nested subpatch not expanded).");
        }
        const arr = outputSources.get(to.port) ?? [];
        arr.push({ nodeId: sourceId, portId: from.port });
        outputSources.set(to.port, arr);
        continue;
      }

      const fromId = idMap.get(from.node);
      const toId = idMap.get(to.node);
      if (!fromId || !toId) {
        throw new Error("Subpatch internal connection references unsupported nodes.");
      }
      flatConnections.push({
        id: nanoid(),
        from: { node: fromId, port: from.port },
        to: { node: toId, port: to.port }
      });
    }

    subpatchBridges.set(node.id, { inputTargets, outputSources, passThrough });
  }

  // Collect parent level connections for subpatch bridging
  const incomingSources = new Map<string, Map<string, Endpoint[]>>(); // nodeId -> port -> sources
  const outgoingTargets = new Map<string, Map<string, Endpoint[]>>(); // nodeId -> port -> targets

  const addIncomingSource = (nodeId: string, portId: string, endpoint: Endpoint) => {
    const byPort = incomingSources.get(nodeId) ?? new Map<string, Endpoint[]>();
    const arr = byPort.get(portId) ?? [];
    arr.push(endpoint);
    byPort.set(portId, arr);
    incomingSources.set(nodeId, byPort);
  };

  const addOutgoingTarget = (nodeId: string, portId: string, endpoint: Endpoint) => {
    const byPort = outgoingTargets.get(nodeId) ?? new Map<string, Endpoint[]>();
    const arr = byPort.get(portId) ?? [];
    arr.push(endpoint);
    byPort.set(portId, arr);
    outgoingTargets.set(nodeId, byPort);
  };

  for (const connection of root.connections) {
    const { from, to } = connection;
    const fromIsSubpatch = rootKindMap.get(from.node) === "logic.subpatch";
    const toIsSubpatch = rootKindMap.get(to.node) === "logic.subpatch";

    if (!fromIsSubpatch && !toIsSubpatch) {
      const mappedFrom = nodeIdMap.get(from.node);
      const mappedTo = nodeIdMap.get(to.node);
      if (!mappedFrom || !mappedTo) {
        continue;
      }
      flatConnections.push({
        id: connection.id,
        from: { node: mappedFrom, port: from.port },
        to: { node: mappedTo, port: to.port }
      });
      continue;
    }

    if (toIsSubpatch) {
      const mappedFrom = nodeIdMap.get(from.node);
      if (mappedFrom) {
        addIncomingSource(to.node, to.port, { nodeId: mappedFrom, portId: from.port });
      }
    }

    if (fromIsSubpatch) {
      const mappedTo = nodeIdMap.get(to.node);
      if (mappedTo) {
        addOutgoingTarget(from.node, from.port, { nodeId: mappedTo, portId: to.port });
      }
    }
  }

  // Wire subpatch bridges
  for (const [nodeId, bridge] of subpatchBridges.entries()) {
    const sourcesByPort = incomingSources.get(nodeId) ?? new Map<string, Endpoint[]>();
    const targetsByPort = outgoingTargets.get(nodeId) ?? new Map<string, Endpoint[]>();

    for (const [portId, sources] of sourcesByPort.entries()) {
      const targets = bridge.inputTargets.get(portId) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          flatConnections.push({
            id: nanoid(),
            from: { node: source.nodeId, port: source.portId },
            to: { node: target.nodeId, port: target.portId }
          });
        }
      }
    }

    for (const [portId, targets] of targetsByPort.entries()) {
      const sources = bridge.outputSources.get(portId) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          flatConnections.push({
            id: nanoid(),
            from: { node: source.nodeId, port: source.portId },
            to: { node: target.nodeId, port: target.portId }
          });
        }
      }
    }

    for (const [inputSpec, outputSpec] of bridge.passThrough.entries()) {
      const sources = sourcesByPort.get(inputSpec) ?? [];
      const targets = targetsByPort.get(outputSpec) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          flatConnections.push({
            id: nanoid(),
            from: { node: source.nodeId, port: source.portId },
            to: { node: target.nodeId, port: target.portId }
          });
        }
      }
    }
  }

  const flattened: PatchGraph = {
    nodes: flatNodes,
    connections: flatConnections,
    sampleRate: root.sampleRate,
    blockSize: root.blockSize,
    oversampling: root.oversampling,
    subpatches: {},
    rootSubpatchId: root.rootSubpatchId
  };

  return flattened;
}
