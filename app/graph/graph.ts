import { nanoid } from "@codegen/utils/nanoid";
import {
  Connection,
  NodeDescriptor,
  NodePosition,
  PatchGraph,
  PortDescriptor
} from "./types";

export interface CreateGraphOptions {
  sampleRate?: number;
  blockSize?: PatchGraph["blockSize"];
  oversampling?: PatchGraph["oversampling"];
}

export function createGraph(options: CreateGraphOptions = {}): PatchGraph {
  return {
    nodes: [],
    connections: [],
    sampleRate: options.sampleRate ?? 48_000,
    blockSize: options.blockSize ?? 128,
    oversampling: options.oversampling ?? 1
  };
}

export function addNode(graph: PatchGraph, node: NodeDescriptor): PatchGraph {
  return {
    ...graph,
    nodes: [...graph.nodes, node]
  };
}

export interface ConnectNodesParams {
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

export function connectNodes(
  graph: PatchGraph,
  params: ConnectNodesParams
): PatchGraph {
  const { fromNodeId, fromPortId, toNodeId, toPortId } = params;

  const fromNode = findNodeOrThrow(graph, fromNodeId);
  const toNode = findNodeOrThrow(graph, toNodeId);
  const fromPort = findPortOrThrow(fromNode.outputs, fromPortId, "output");
  const toPort = findPortOrThrow(toNode.inputs, toPortId, "input");

  if (fromPort.type !== toPort.type) {
    throw new Error(
      `Port type mismatch: ${fromNode.kind}:${fromPort.id} -> ${toNode.kind}:${toPort.id}`
    );
  }

  const duplicate = graph.connections.some(
    (connection) =>
      connection.from.node === fromNodeId &&
      connection.from.port === fromPortId &&
      connection.to.node === toNodeId &&
      connection.to.port === toPortId
  );

  if (duplicate) {
    throw new Error(
      `Duplicate connection: ${fromNodeId}.${fromPortId} -> ${toNodeId}.${toPortId}`
    );
  }

  const connection: Connection = {
    id: nanoid(),
    from: { node: fromNodeId, port: fromPortId },
    to: { node: toNodeId, port: toPortId }
  };

  return {
    ...graph,
    connections: [...graph.connections, connection]
  };
}

export function removeNode(graph: PatchGraph, nodeId: string): PatchGraph {
  const nodes = graph.nodes.filter((node) => node.id !== nodeId);
  if (nodes.length === graph.nodes.length) {
    return graph;
  }

  const connections = graph.connections.filter(
    (connection) =>
      connection.from.node !== nodeId && connection.to.node !== nodeId
  );

  return {
    ...graph,
    nodes,
    connections
  };
}

export function removeConnection(
  graph: PatchGraph,
  connectionId: string
): PatchGraph {
  const connections = graph.connections.filter(
    (connection) => connection.id !== connectionId
  );

  if (connections.length === graph.connections.length) {
    return graph;
  }

  return {
    ...graph,
    connections
  };
}

export function updateNodePosition(
  graph: PatchGraph,
  nodeId: string,
  position: NodePosition
): PatchGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    const currentPosition = node.metadata?.position;
    if (
      currentPosition &&
      currentPosition.x === position.x &&
      currentPosition.y === position.y
    ) {
      return node;
    }

    changed = true;

    return {
      ...node,
      metadata: {
        ...(node.metadata ?? {}),
        position: { x: position.x, y: position.y }
      }
    };
  });

  if (!changed) {
    return graph;
  }

  return {
    ...graph,
    nodes
  };
}

function findNodeOrThrow(graph: PatchGraph, nodeId: string): NodeDescriptor {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Unknown node id: ${nodeId}`);
  }
  return node;
}

function findPortOrThrow(
  ports: PortDescriptor[],
  portId: string,
  role: "input" | "output"
): PortDescriptor {
  const port = ports.find((candidate) => candidate.id === portId);
  if (!port) {
    throw new Error(`Unknown ${role} port: ${portId}`);
  }
  return port;
}
