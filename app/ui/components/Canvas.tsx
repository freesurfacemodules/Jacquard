import { useCallback, useMemo, useRef, useState } from "react";
import { usePatch } from "../state/PatchContext";
import { getNodeImplementation, instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";
import { NodePalette } from "./NodePalette";
import { PatchNode } from "./PatchNode";
import type { NodeDescriptor, NodeMetadata, NodePosition } from "@graph/types";

type Point = { x: number; y: number };

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 160;
const NODE_HEADER_HEIGHT = 40;
const PORT_ROW_HEIGHT = 28;
const PORT_VERTICAL_PADDING = 12;
const GRID_X = 240;
const GRID_Y = 200;
const GRID_ORIGIN_X = 80;
const GRID_ORIGIN_Y = 80;

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

function getNodeMetadata(node: NodeDescriptor): NodeMetadata | undefined {
  return node.metadata as NodeMetadata | undefined;
}

function getNodePosition(node: NodeDescriptor): NodePosition {
  const metadata = getNodeMetadata(node);
  if (metadata?.position) {
    return metadata.position;
  }
  return { x: GRID_ORIGIN_X, y: GRID_ORIGIN_Y };
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
    x: GRID_ORIGIN_X + column * GRID_X,
    y: GRID_ORIGIN_Y + row * GRID_Y
  };
}

function getPortAnchor(
  node: NodeDescriptor,
  kind: "input" | "output",
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

export function Canvas(): JSX.Element {
  const {
    viewModel,
    addNode,
    connectNodes,
    updateNodePosition
  } = usePatch();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(
    null
  );
  const [pointerPosition, setPointerPosition] = useState<Point | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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

        const fromPortIndex = fromNode.outputs.findIndex(
          (port) => port.id === connection.from.port
        );
        const toPortIndex = toNode.inputs.findIndex(
          (port) => port.id === connection.to.port
        );

        if (fromPortIndex === -1 || toPortIndex === -1) {
          return null;
        }

        const start = getPortAnchor(fromNode, "output", fromPortIndex, fromPosition);
        const end = getPortAnchor(toNode, "input", toPortIndex, toPosition);

        return {
          id: connection.id,
          path: createConnectionPath(start, end)
        };
      })
      .filter(Boolean) as Array<{ id: string; path: string }>;
  }, [viewModel.connections, nodesById, nodePositions]);

  const handleCreateNode = useCallback(
    (kind: string) => {
      const node = instantiateNode(kind, nanoid());
      const position = computeSpawnPosition(viewModel.nodes);
      node.metadata = {
        ...(node.metadata ?? {}),
        position
      };
      addNode(node);
      setSelectedNodeId(node.id);
      setConnectionError(null);
    },
    [addNode, viewModel.nodes]
  );

  const translatePointerToCanvas = useCallback(
    (event: React.PointerEvent | PointerEvent): Point | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return null;
      }
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    },
    []
  );

  const handleCanvasPointerDown = useCallback(() => {
    setSelectedNodeId(null);
    setPendingConnection(null);
    setPointerPosition(null);
    setConnectionError(null);
  }, []);

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pendingConnection) {
        return;
      }
      const point = translatePointerToCanvas(event);
      if (point) {
        setPointerPosition(point);
      }
    },
    [pendingConnection, translatePointerToCanvas]
  );

  const handleCanvasPointerUp = useCallback(() => {
    if (pendingConnection) {
      setPendingConnection(null);
      setPointerPosition(null);
    }
  }, [pendingConnection]);

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
        x: Math.max(0, point.x - state.offset.x),
        y: Math.max(0, point.y - state.offset.y)
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
      const node = nodesById.get(nodeId);
      const position = nodePositions.get(nodeId);
      if (!node || !position) {
        return;
      }
      const anchor = getPortAnchor(node, "output", portIndex, position);
      setPendingConnection({
        fromNodeId: nodeId,
        fromPortId: portId,
        fromPortIndex: portIndex,
        anchor
      });
      setPointerPosition(anchor);
      setConnectionError(null);
    },
    [nodesById, nodePositions]
  );

  const handleInputPointerUp = useCallback(
    (
      nodeId: string,
      portId: string,
      _portIndex: number,
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
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
    [pendingConnection, connectNodes]
  );

  return (
    <section className="canvas-pane" aria-label="Patch editor">
      <header className="canvas-header">
        <h1>Patch</h1>
        <NodePalette onCreateNode={handleCreateNode} />
      </header>
      <div
        ref={canvasRef}
        className="canvas-body"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
      >
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

        {viewModel.nodes.map((node) => {
          const position = nodePositions.get(node.id) ?? getNodePosition(node);
          const { width } = getNodeDimensions(node);
          return (
            <PatchNode
              key={node.id}
              node={node}
              position={position}
              width={width}
              selected={selectedNodeId === node.id}
              onSelect={setSelectedNodeId}
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onDragEnd={handleDragEnd}
              onOutputPointerDown={handleOutputPointerDown}
              onInputPointerUp={handleInputPointerUp}
            />
          );
        })}

        {viewModel.nodes.length === 0 ? (
          <div className="canvas-placeholder">
            <p>Add nodes from the palette to start building a patch.</p>
          </div>
        ) : null}

        {connectionError ? (
          <div className="canvas-message canvas-message--error">{connectionError}</div>
        ) : null}
      </div>
    </section>
  );
}
