import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePatch } from "../state/PatchContext";
import { getNodeImplementation, instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";
import { PatchNode, type PortKind } from "./PatchNode";
import { EnvelopeVisualizer } from "./EnvelopeVisualizer";
import { ScopeVisualizer } from "./ScopeVisualizer";
import type { NodeDescriptor, NodeMetadata, NodePosition } from "@graph/types";

export type Point = { x: number; y: number };

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 160;
const NODE_HEADER_HEIGHT = 40;
const PORT_ROW_HEIGHT = 28;
const PORT_VERTICAL_PADDING = 12;
const GRID_X = 240;
const GRID_Y = 200;
const GRID_ORIGIN_X = 80;
const GRID_ORIGIN_Y = 80;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const ZOOM_SENSITIVITY = 0.0015;
const WORKSPACE_MIN = -2048;
const WORKSPACE_MAX = 8192;
const WORKSPACE_SIZE = WORKSPACE_MAX - WORKSPACE_MIN;
const ORIGIN_OFFSET = -WORKSPACE_MIN;
const DELAY_NODE_KINDS = new Set<string>(["delay.ddl", "delay.waveguide"]);

const cssEscape = (value: string): string => {
  if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
};

interface PendingConnection {
  fromNodeId: string;
  fromPortId: string;
  fromPortIndex: number;
  anchor: Point;
}

interface DragState {
  nodeId: string;
  pointerId: number;
  offset: Point;
}

interface NodeConnectionSummary {
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}

interface CanvasProps {
  onOpenCommandPalette(canvasPoint: Point | null, screenPoint: { x: number; y: number } | null): void;
  pendingNodeCreation: { kind: string; position: Point | null } | null;
  onNodeCreationHandled(): void;
}

function getNodeMetadata(node: NodeDescriptor): NodeMetadata | undefined {
  return node.metadata as NodeMetadata | undefined;
}

function getNodePosition(node: NodeDescriptor): NodePosition {
  const metadata = getNodeMetadata(node);
  if (metadata?.position) {
    return metadata.position;
  }
  return { x: 0, y: 0 };
}

function getNodeDimensions(node: NodeDescriptor): { width: number; height: number } {
  const implementation = getNodeImplementation(node.kind);
  const appearance = implementation?.manifest.appearance;
  return {
    width: appearance?.width ?? DEFAULT_NODE_WIDTH,
    height: appearance?.height ?? DEFAULT_NODE_HEIGHT
  };
}

function computeSpawnPosition(nodes: NodeDescriptor[]): Point {
  const index = nodes.length;
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: clampCoordinate(column * GRID_X),
    y: clampCoordinate(row * GRID_Y)
  };
}

function getPortAnchor(
  node: NodeDescriptor,
  kind: PortKind,
  portIndex: number,
  position: Point
): Point {
  const { width } = getNodeDimensions(node);
  const x = kind === "input" ? position.x : position.x + width;
  const y =
    position.y +
    NODE_HEADER_HEIGHT +
    PORT_VERTICAL_PADDING +
    portIndex * PORT_ROW_HEIGHT +
    PORT_ROW_HEIGHT / 2;
  return { x, y };
}

function createConnectionPath(start: Point, end: Point): string {
  const dx = Math.max(Math.abs(end.x - start.x) * 0.45, 60);
  return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y} ${end.x - dx} ${end.y} ${end.x} ${end.y}`;
}

function clampCoordinate(value: number): number {
  return Math.min(WORKSPACE_MAX, Math.max(WORKSPACE_MIN, value));
}

function toDisplay(point: Point): Point {
  return {
    x: clampCoordinate(point.x) + ORIGIN_OFFSET,
    y: clampCoordinate(point.y) + ORIGIN_OFFSET
  };
}

function getDomPortAnchor(
  nodeId: string,
  portId: string,
  kind: PortKind,
  screenToCanvas: (x: number, y: number) => Point | null
): Point | null {
  if (typeof document === "undefined") {
    return null;
  }
  const selector = `.patch-node__port-indicator[data-node-id="${cssEscape(nodeId)}"][data-port-id="${cssEscape(portId)}"][data-port-kind="${kind}"]`;
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

export function Canvas({
  onOpenCommandPalette,
  pendingNodeCreation,
  onNodeCreationHandled
}: CanvasProps): JSX.Element {
  const {
    viewModel,
    addNode,
    connectNodes,
    removeConnectionsFromPort,
    removeConnectionsToPort,
    removeNode,
    updateNodePosition,
    updateNodeParameter,
    selectedNodeId,
    selectNode,
    envelopeSnapshots,
    getEnvelopeSnapshot,
    scopeSnapshots,
    getScopeSnapshot,
    getParameterValue
  } = usePatch();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [pointerPosition, setPointerPosition] = useState<Point | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState(1);
  const [viewOffset, setViewOffset] = useState<Point>({ x: 0, y: 0 });
  const panStateRef = useRef<{
    pointerId: number;
    origin: Point;
    startOffset: Point;
  } | null>(null);
  const initializedRef = useRef(false);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return null;
      }
      const localX = screenX - rect.left;
      const localY = screenY - rect.top;
      const workspaceX = ((localX - viewOffset.x) / viewScale) - ORIGIN_OFFSET;
      const workspaceY = ((localY - viewOffset.y) / viewScale) - ORIGIN_OFFSET;
      return {
        x: clampCoordinate(workspaceX),
        y: clampCoordinate(workspaceY)
      };
    },
    [viewOffset.x, viewOffset.y, viewScale]
  );

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    const element = canvasRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    initializedRef.current = true;
    setViewOffset({
      x: rect.width / 2 - ORIGIN_OFFSET * viewScale,
      y: rect.height / 2 - ORIGIN_OFFSET * viewScale
    });
  }, [viewScale]);

  const nodePositions = useMemo(() => {
    return new Map<string, Point>(
      viewModel.nodes.map((node) => [node.id, getNodePosition(node)])
    );
  }, [viewModel.nodes]);

  const nodesById = useMemo(() => {
    return new Map<string, NodeDescriptor>(
      viewModel.nodes.map((node) => [node.id, node])
    );
  }, [viewModel.nodes]);

  const portConnectionMap = useMemo(() => {
    const map = new Map<string, NodeConnectionSummary>();
    for (const node of viewModel.nodes) {
      const inputs: Record<string, number> = {};
      const outputs: Record<string, number> = {};
      for (const port of node.inputs) {
        inputs[port.id] = 0;
      }
      for (const port of node.outputs) {
        outputs[port.id] = 0;
      }
      map.set(node.id, { inputs, outputs });
    }

    for (const connection of viewModel.connections) {
      const source = map.get(connection.from.node);
      const target = map.get(connection.to.node);
      if (source && source.outputs[connection.from.port] !== undefined) {
        source.outputs[connection.from.port] += 1;
      }
      if (target && target.inputs[connection.to.port] !== undefined) {
        target.inputs[connection.to.port] += 1;
      }
    }

    return map;
  }, [viewModel.connections, viewModel.nodes]);

  const connectionPaths = useMemo(() => {
    return viewModel.connections
      .map((connection) => {
        const fromNode = nodesById.get(connection.from.node);
        const toNode = nodesById.get(connection.to.node);
        if (!fromNode || !toNode) {
          return null;
        }

        const fromPosition = nodePositions.get(fromNode.id);
        const toPosition = nodePositions.get(toNode.id);
        if (!fromPosition || !toPosition) {
          return null;
        }

        const fromPortIndex = fromNode.outputs.findIndex((port) => port.id === connection.from.port);
        const toPortIndex = toNode.inputs.findIndex((port) => port.id === connection.to.port);

        if (fromPortIndex === -1 || toPortIndex === -1) {
          return null;
        }

        const fromDisplay = toDisplay(fromPosition);
        const toDisplayPos = toDisplay(toPosition);

        const fallbackStart = getPortAnchor(fromNode, "output", fromPortIndex, fromDisplay);
        const fallbackEnd = getPortAnchor(toNode, "input", toPortIndex, toDisplayPos);

        const startDom = getDomPortAnchor(fromNode.id, connection.from.port, "output", screenToCanvas);
        const endDom = getDomPortAnchor(toNode.id, connection.to.port, "input", screenToCanvas);

        const start = startDom ? toDisplay(startDom) : fallbackStart;
        const end = endDom ? toDisplay(endDom) : fallbackEnd;

        return {
          id: connection.id,
          path: createConnectionPath(start, end)
        };
      })
      .filter(Boolean) as Array<{ id: string; path: string }>;
  }, [viewModel.connections, nodesById, nodePositions, screenToCanvas]);

  const activeOutputPortId = pendingConnection?.fromPortId ?? null;

  const handleCreateNode = useCallback(
    (kind: string, anchor?: Point | null) => {
      const node = instantiateNode(kind, nanoid());
      let position = computeSpawnPosition(viewModel.nodes);
      if (anchor) {
        const { width, height } = getNodeDimensions(node);
        position = {
          x: clampCoordinate(anchor.x - width / 2),
          y: clampCoordinate(anchor.y - height / 2)
        };
      }
      node.metadata = {
        ...(node.metadata ?? {}),
        position
      };
      addNode(node);
      selectNode(node.id);
      setConnectionError(null);
    },
    [addNode, selectNode, viewModel.nodes]
  );

  useEffect(() => {
    if (!pendingNodeCreation) {
      return;
    }
    handleCreateNode(pendingNodeCreation.kind, pendingNodeCreation.position);
    onNodeCreationHandled();
  }, [handleCreateNode, onNodeCreationHandled, pendingNodeCreation]);

  const translatePointerToCanvas = useCallback(
    (event: React.PointerEvent | PointerEvent): Point | null => {
      return screenToCanvas(event.clientX, event.clientY);
    },
    [screenToCanvas]
  );

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      selectNode(null);
      setPendingConnection(null);
      setPointerPosition(null);
      setConnectionError(null);

      if (event.button !== 0) {
        return;
      }

      panStateRef.current = {
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        startOffset: { ...viewOffset }
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [selectNode, viewOffset]
  );

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const panState = panStateRef.current;
      if (panState && panState.pointerId === event.pointerId) {
        const dx = event.clientX - panState.origin.x;
        const dy = event.clientY - panState.origin.y;
        setViewOffset({
          x: panState.startOffset.x + dx,
          y: panState.startOffset.y + dy
        });
        return;
      }

      if (!pendingConnection) {
        return;
      }
      const point = translatePointerToCanvas(event);
      if (point) {
        setPointerPosition(toDisplay(point));
      }
    },
    [pendingConnection, translatePointerToCanvas]
  );

  const handleCanvasPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const panState = panStateRef.current;
      if (panState && panState.pointerId === event.pointerId) {
        panStateRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (pendingConnection) {
        setPendingConnection(null);
        setPointerPosition(null);
      }
    },
    [pendingConnection]
  );

  const handleCanvasPointerLeave = useCallback(() => {
    panStateRef.current = null;
  }, []);

  const handleWheelNative = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const worldX = ((screenX - viewOffset.x) / viewScale) - ORIGIN_OFFSET;
      const worldY = ((screenY - viewOffset.y) / viewScale) - ORIGIN_OFFSET;

      const delta = -event.deltaY * ZOOM_SENSITIVITY;
      const factor = Math.exp(delta);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewScale * factor));

      const nextOffset = {
        x: screenX - (worldX + ORIGIN_OFFSET) * nextScale,
        y: screenY - (worldY + ORIGIN_OFFSET) * nextScale
      };

      setViewScale(nextScale);
      setViewOffset(nextOffset);
    },
    [viewOffset, viewScale]
  );

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) {
      return;
    }
    const listener = (event: WheelEvent) => handleWheelNative(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => {
      element.removeEventListener("wheel", listener);
    };
  }, [handleWheelNative]);

  const handleDragStart = useCallback(
    (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => {
      const point = translatePointerToCanvas(event);
      if (!point) {
        return;
      }
      const nodePosition = nodePositions.get(nodeId) ?? point;
      dragStateRef.current = {
        nodeId,
        pointerId: event.pointerId,
        offset: {
          x: point.x - nodePosition.x,
          y: point.y - nodePosition.y
        }
      };
    },
    [nodePositions, translatePointerToCanvas]
  );

  const handleDrag = useCallback(
    (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.nodeId !== nodeId || state.pointerId !== event.pointerId) {
        return;
      }

      const point = translatePointerToCanvas(event);
      if (!point) {
        return;
      }

      const nextPosition: Point = {
        x: clampCoordinate(point.x - state.offset.x),
        y: clampCoordinate(point.y - state.offset.y)
      };

      updateNodePosition(nodeId, nextPosition);
    },
    [translatePointerToCanvas, updateNodePosition]
  );

  const handleDragEnd = useCallback(() => {
    dragStateRef.current = null;
  }, []);

  const handleOutputPointerDown = useCallback(
    (
      nodeId: string,
      portId: string,
      portIndex: number,
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      if (event.altKey) {
        removeConnectionsFromPort(nodeId, portId);
        setPendingConnection(null);
        setPointerPosition(null);
        setConnectionError(null);
        return;
      }
      const node = nodesById.get(nodeId);
      const position = nodePositions.get(nodeId);
      if (!node || !position) {
        return;
      }
      const domAnchor = getDomPortAnchor(nodeId, portId, "output", screenToCanvas);
      const fallbackAnchor = getPortAnchor(node, "output", portIndex, toDisplay(position));
      const anchor = domAnchor ? toDisplay(domAnchor) : fallbackAnchor;
      setPendingConnection({
        fromNodeId: nodeId,
        fromPortId: portId,
        fromPortIndex: portIndex,
        anchor
      });
      setPointerPosition(anchor);
      setConnectionError(null);
    },
    [nodesById, nodePositions, removeConnectionsFromPort, screenToCanvas]
  );

  const handleInputPointerUp = useCallback(
    (
      nodeId: string,
      portId: string,
      _portIndex: number,
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      if (event.altKey) {
        removeConnectionsToPort(nodeId, portId);
        setPendingConnection(null);
        setPointerPosition(null);
        setConnectionError(null);
        return;
      }
      if (!pendingConnection) {
        return;
      }

      try {
        connectNodes({
          fromNodeId: pendingConnection.fromNodeId,
          fromPortId: pendingConnection.fromPortId,
          toNodeId: nodeId,
          toPortId: portId
        });
        setPendingConnection(null);
        setPointerPosition(null);
        setConnectionError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setConnectionError(message);
      }
    },
    [pendingConnection, connectNodes, removeConnectionsToPort]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!selectedNodeId) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        const editable =
          target.isContentEditable ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT";
        if (editable) {
          return;
        }
      }

      event.preventDefault();
      removeNode(selectedNodeId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedNodeId, removeNode]);

  const handleControlChange = useCallback(
    (nodeId: string, controlId: string, value: number) => {
      updateNodeParameter(nodeId, controlId, value);
    },
    [updateNodeParameter]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const canvasPoint = screenToCanvas(event.clientX, event.clientY);
      onOpenCommandPalette(canvasPoint, { x: event.clientX, y: event.clientY });
    },
    [onOpenCommandPalette, screenToCanvas]
  );

  return (
    <section className="canvas-pane" aria-label="Patch editor">
      <div
        ref={canvasRef}
        className="canvas-body"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerLeave}
        onContextMenu={handleContextMenu}
      >
        <div
          className="canvas-content"
          style={{
            width: WORKSPACE_SIZE,
            height: WORKSPACE_SIZE,
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`
          }}
        >
          {viewModel.nodes.map((node) => {
            const positionWorld = nodePositions.get(node.id) ?? getNodePosition(node);
            const positionDisplay = toDisplay(positionWorld);
            const { width } = getNodeDimensions(node);
            const implementation = getNodeImplementation(node.kind);
            const controls = implementation?.manifest.controls ?? [];
            const controlConfigs = controls.map((control) => {
              let min = control.min ?? 0;
              const max = control.max ?? 1;
              let step = control.step ?? 0.01;
              if (DELAY_NODE_KINDS.has(node.kind) && control.id === "delay") {
                const dynamicStep = 1 / viewModel.oversampling;
                min = dynamicStep;
                step = dynamicStep;
              }
              const defaults = implementation?.manifest.defaultParams ?? {};
              const manifestDefault = defaults[control.id];
              let defaultValue =
                typeof manifestDefault === "number" ? manifestDefault : min;
              defaultValue = Math.min(max, Math.max(min, defaultValue));
              if (step > 0) {
                defaultValue = Math.round(defaultValue / step) * step;
              }
              const rawValue = getParameterValue(node.id, control.id);
              const clampedValue = Math.min(max, Math.max(min, rawValue));
              const quantized = step > 0 ? Math.round(clampedValue / step) * step : clampedValue;
              return {
                id: control.id,
                label: control.label,
                value: quantized,
                min,
                max,
                step,
                defaultValue
              };
            });
            let widget: ReactNode | null = null;
            if (node.kind === "envelope.ad") {
              const riseValue =
                controlConfigs.find((control) => control.id === "rise")?.value ?? 0.05;
              const fallValue =
                controlConfigs.find((control) => control.id === "fall")?.value ?? 0.25;
              const shapeValue =
                controlConfigs.find((control) => control.id === "shape")?.value ?? 0.5;
              const snapshot = envelopeSnapshots[node.id] ?? getEnvelopeSnapshot(node.id);
              widget = (
                <EnvelopeVisualizer
                  rise={riseValue}
                  fall={fallValue}
                  curve={shapeValue}
                  value={snapshot.value}
                  progress={snapshot.progress}
                />
              );
            } else if (node.kind === "utility.scope") {
              const scaleValue =
                controlConfigs.find((control) => control.id === "scale")?.value ?? 5;
              const timeValue =
                controlConfigs.find((control) => control.id === "time")?.value ?? 0.05;
              const snapshot = scopeSnapshots[node.id] ?? getScopeSnapshot(node.id);
              widget = (
                <ScopeVisualizer
                  samples={snapshot.samples}
                  sampleInterval={
                    snapshot.sampleInterval || (1 / Math.max(1, viewModel.sampleRate))
                  }
                  scale={snapshot.scale ?? scaleValue}
                  requestedTime={snapshot.requestedTime ?? timeValue}
                  mode={snapshot.mode ?? 0}
                  coverage={
                    snapshot.coverage ??
                    snapshot.samples.length *
                      (snapshot.sampleInterval || (1 / Math.max(1, viewModel.sampleRate)))
                  }
                />
              );
            }

            return (
              <PatchNode
                key={node.id}
                node={node}
                position={positionDisplay}
                width={width}
                selected={selectedNodeId === node.id}
                onSelect={selectNode}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                onOutputPointerDown={handleOutputPointerDown}
                onInputPointerUp={handleInputPointerUp}
                controls={controlConfigs}
                inputConnections={portConnectionMap.get(node.id)?.inputs ?? {}}
                outputConnections={portConnectionMap.get(node.id)?.outputs ?? {}}
                activeOutputPortId={
                  activeOutputPortId && pendingConnection?.fromNodeId === node.id
                    ? activeOutputPortId
                    : null
                }
                onControlChange={handleControlChange}
                widget={widget}
              />
            );
          })}

          <svg className="canvas-connections" aria-hidden="true">
            {connectionPaths.map((connection) => (
              <path key={connection.id} d={connection.path} />
            ))}
            {pendingConnection && pointerPosition ? (
              <path
                className="canvas-connections__pending"
                d={createConnectionPath(pendingConnection.anchor, pointerPosition)}
              />
            ) : null}
          </svg>

          {viewModel.nodes.length === 0 ? (
            <div className="canvas-placeholder">
              <p>Add nodes to start building a patch.</p>
            </div>
          ) : null}

          {connectionError ? (
            <div className="canvas-message canvas-message--error">{connectionError}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
