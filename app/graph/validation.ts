import { NodeDescriptor, PatchGraph } from "./types";

export type GraphValidationCode =
  | "NODE_MISSING"
  | "PORT_MISSING"
  | "TYPE_MISMATCH"
  | "CYCLE_DETECTED"
  | "OUTPUT_INVALID";

export interface GraphValidationIssue {
  code: GraphValidationCode;
  message: string;
  nodes?: string[];
}

export interface GraphValidationResult {
  issues: GraphValidationIssue[];
  isValid: boolean;
  order: NodeDescriptor[];
}

export interface TopologyResult {
  order: NodeDescriptor[];
  hasCycle: boolean;
}

export function validateGraph(graph: PatchGraph): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const connection of graph.connections) {
    const fromNode = nodesById.get(connection.from.node);
    const toNode = nodesById.get(connection.to.node);

    if (!fromNode) {
      issues.push({
        code: "NODE_MISSING",
        message: `Connection references missing source node: ${connection.from.node}`,
        nodes: [connection.from.node]
      });
      continue;
    }

    if (!toNode) {
      issues.push({
        code: "NODE_MISSING",
        message: `Connection references missing target node: ${connection.to.node}`,
        nodes: [connection.to.node]
      });
      continue;
    }

    const fromPort = fromNode.outputs.find(
      (port) => port.id === connection.from.port
    );
    if (!fromPort) {
      issues.push({
        code: "PORT_MISSING",
        message: `Node ${fromNode.id} is missing output port ${connection.from.port}`,
        nodes: [fromNode.id]
      });
      continue;
    }

    const toPort = toNode.inputs.find((port) => port.id === connection.to.port);
    if (!toPort) {
      issues.push({
        code: "PORT_MISSING",
        message: `Node ${toNode.id} is missing input port ${connection.to.port}`,
        nodes: [toNode.id]
      });
      continue;
    }

    if (fromPort.type !== toPort.type) {
      issues.push({
        code: "TYPE_MISMATCH",
        message: `Type mismatch: ${fromNode.kind}:${fromPort.id} -> ${toNode.kind}:${toPort.id}`,
        nodes: [fromNode.id, toNode.id]
      });
    }
  }

  const { order, hasCycle } = topologicalSort(graph);
  if (hasCycle) {
    issues.push({
      code: "CYCLE_DETECTED",
      message:
        "Graph contains at least one feedback loop without a delay to break the cycle."
    });
  }

  const outputNodes = graph.nodes.filter((node) => node.kind === "io.output");
  if (outputNodes.length === 0) {
    issues.push({
      code: "OUTPUT_INVALID",
      message:
        "Graph requires exactly one output node to produce audio buffers."
    });
  } else if (outputNodes.length > 1) {
    issues.push({
      code: "OUTPUT_INVALID",
      message:
        "Multiple output nodes detected. Exactly one output node is supported."
    });
  }

  return {
    issues,
    isValid: issues.length === 0,
    order
  };
}

export function topologicalSort(graph: PatchGraph): TopologyResult {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, new Set());
  }

  for (const connection of graph.connections) {
    if (!nodesById.has(connection.from.node) || !nodesById.has(connection.to.node)) {
      continue;
    }

    const neighbors = adjacency.get(connection.from.node);
    if (neighbors && !neighbors.has(connection.to.node)) {
      neighbors.add(connection.to.node);
      inDegree.set(
        connection.to.node,
        (inDegree.get(connection.to.node) ?? 0) + 1
      );
    }
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const order: NodeDescriptor[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodesById.get(nodeId);
    if (!node) continue;

    order.push(node);

    const neighbors = adjacency.get(nodeId);
    if (!neighbors) continue;

    for (const neighborId of neighbors) {
      const nextDegree = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighborId);
      }
    }
  }

  const hasCycle = order.length !== graph.nodes.length;
  return { order, hasCycle };
}
