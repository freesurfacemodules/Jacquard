import { validateGraph } from "@graph/validation";
import {
  Connection,
  NodeDescriptor,
  PatchGraph,
  PortDescriptor
} from "@graph/types";
import { getNodeImplementation } from "@dsp/library";

export interface PlanWire {
  id: string;
  varName: string;
  connection: Connection;
  fromNode: NodeDescriptor;
  toNode: NodeDescriptor;
  fromPort: PortDescriptor;
  toPort: PortDescriptor;
}

export interface PlanInput {
  port: PortDescriptor;
  wires: PlanWire[];
  parameterValue: number | null;
  fallbackValue: number;
}

export interface PlanOutput {
  port: PortDescriptor;
  wires: PlanWire[];
}

export interface PlanControl {
  nodeId: string;
  controlId: string;
  index: number;
  defaultValue: number;
}

export interface EnvelopeMonitor {
  nodeId: string;
  kind: string;
  index: number;
}

export interface ScopeMonitor {
  nodeId: string;
  kind: string;
  index: number;
  capacity: number;
  levelCount: number;
  levelFactors: number[];
}

export interface PlanNode {
  node: NodeDescriptor;
  inputs: PlanInput[];
  outputs: PlanOutput[];
  controls: PlanControl[];
  envelopeMonitorIndex?: number;
  scopeMonitorIndex?: number;
}

export interface ExecutionPlan {
  wires: PlanWire[];
  nodes: PlanNode[];
  outputNode: PlanNode;
  controls: PlanControl[];
  parameterCount: number;
  envelopeMonitors: EnvelopeMonitor[];
  scopeMonitors: ScopeMonitor[];
}

export function createExecutionPlan(graph: PatchGraph): ExecutionPlan {
  const validation = validateGraph(graph);

  if (!validation.isValid) {
    const detail = validation.issues
      .map((issue) => `- ${issue.message}`)
      .join("\n");
    throw new Error(`Graph validation failed:\n${detail}`);
  }

  const order = validation.order;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  const wires: PlanWire[] = [];
  const inputMap = new Map<string, PlanWire[]>();
  const outputMap = new Map<string, PlanWire[]>();
  const controls: PlanControl[] = [];
  let parameterCounter = 0;
  const envelopeMonitors: EnvelopeMonitor[] = [];
  const scopeMonitors: ScopeMonitor[] = [];
  let envelopeMonitorCounter = 0;
  let scopeMonitorCounter = 0;
  const scopeLevelFactors = [1, 2, 4, 8];
  const scopeMonitorCapacity = Math.max(
    2048,
    Math.min(8192, Math.ceil(graph.sampleRate / 12))
  );

  graph.connections.forEach((connection, index) => {
    const fromNode = nodesById.get(connection.from.node);
    const toNode = nodesById.get(connection.to.node);
    if (!fromNode || !toNode) {
      return;
    }

    const fromPort = fromNode.outputs.find(
      (port) => port.id === connection.from.port
    );
    const toPort = toNode.inputs.find(
      (port) => port.id === connection.to.port
    );
    if (!fromPort || !toPort) {
      return;
    }

    const wire: PlanWire = {
      id: connection.id,
      varName: `wire${index}`,
      connection,
      fromNode,
      toNode,
      fromPort,
      toPort
    };

    wires.push(wire);

    const inputKey = makeKey(connection.to.node, connection.to.port);
    const outputKey = makeKey(connection.from.node, connection.from.port);

    if (!inputMap.has(inputKey)) {
      inputMap.set(inputKey, []);
    }
    inputMap.get(inputKey)!.push(wire);

    if (!outputMap.has(outputKey)) {
      outputMap.set(outputKey, []);
    }
    outputMap.get(outputKey)!.push(wire);
  });

  const planNodes: PlanNode[] = order.map((node) => {
    const inputs = node.inputs.map((port) => {
      const key = makeKey(node.id, port.id);
      const wiresForPort = inputMap.get(key) ?? [];
      const parameterValue =
        typeof node.parameters?.[port.id] === "number"
          ? node.parameters![port.id]
          : null;

      return {
        port,
        wires: wiresForPort,
        parameterValue,
        fallbackValue: 0
      };
    });

    const outputs = node.outputs.map((port) => {
      const key = makeKey(node.id, port.id);
      return {
        port,
        wires: outputMap.get(key) ?? []
      };
    });

    const implementation = getNodeImplementation(node.kind);
    const manifestControls = implementation?.manifest.controls ?? [];
    const nodeControls: PlanControl[] = manifestControls.map((control) => {
      const defaultValue =
        typeof node.parameters[control.id] === "number"
          ? node.parameters[control.id]
          : implementation?.manifest.defaultParams?.[control.id] ??
            control.min ?? 0;
      const planControl: PlanControl = {
        nodeId: node.id,
        controlId: control.id,
        index: parameterCounter++,
        defaultValue
      };
      controls.push(planControl);
      return planControl;
    });

    return {
      node,
      inputs,
      outputs,
      controls: nodeControls
    };
  });

  for (const planNode of planNodes) {
    switch (planNode.node.kind) {
      case "envelope.ad": {
        const monitorIndex = envelopeMonitorCounter++;
        planNode.envelopeMonitorIndex = monitorIndex;
        envelopeMonitors.push({
          nodeId: planNode.node.id,
          kind: planNode.node.kind,
          index: monitorIndex
        });
        break;
      }
      case "utility.scope": {
        const monitorIndex = scopeMonitorCounter++;
        planNode.scopeMonitorIndex = monitorIndex;
        scopeMonitors.push({
          nodeId: planNode.node.id,
          kind: planNode.node.kind,
          index: monitorIndex,
          capacity: scopeMonitorCapacity,
          levelCount: scopeLevelFactors.length,
          levelFactors: [...scopeLevelFactors]
        });
        break;
      }
      default:
        break;
    }
  }

  const outputNode = planNodes.find((planNode) => planNode.node.kind === "io.output");
  if (!outputNode) {
    throw new Error("Execution plan requires a single io.output node.");
  }

  return {
    wires,
    nodes: planNodes,
    outputNode,
    controls,
    parameterCount: parameterCounter,
    envelopeMonitors,
    scopeMonitors
  };
}

function makeKey(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`;
}
