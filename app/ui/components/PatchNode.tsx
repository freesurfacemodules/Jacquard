import { memo } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { NodeDescriptor } from "@graph/types";
import { Knob } from "./Knob";

export type PortKind = "input" | "output";

interface PatchNodeProps {
  node: NodeDescriptor;
  position: { x: number; y: number };
  width: number;
  selected: boolean;
  onPointerDown(nodeId: string, event: ReactPointerEvent, region: "body" | "header"): void;
  onPointerUp(nodeId: string, event: ReactPointerEvent, region: "body" | "header"): void;
  onDragStart(nodeId: string, event: ReactPointerEvent<HTMLDivElement>): void;
  onDrag(nodeId: string, event: ReactPointerEvent<HTMLDivElement>): void;
  onDragEnd(nodeId: string, event: ReactPointerEvent<HTMLDivElement>): void;
  onOutputPointerDown(
    nodeId: string,
    portId: string,
    portIndex: number,
    event: React.PointerEvent<HTMLButtonElement>
  ): void;
  onInputPointerUp(
    nodeId: string,
    portId: string,
    portIndex: number,
    event: React.PointerEvent<HTMLButtonElement>
  ): void;
  controls: Array<{
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue: number;
  }>;
  inputConnections: Record<string, number>;
  outputConnections: Record<string, number>;
  activeOutputPortId: string | null;
  onControlChange(nodeId: string, controlId: string, value: number): void;
  widget?: ReactNode;
  onContextMenu(nodeId: string, event: ReactMouseEvent<HTMLDivElement>): void;
  onDoubleClick?(nodeId: string, event: ReactMouseEvent<HTMLDivElement>): void;
}

const classNames = (
  base: string,
  options: Array<[boolean, string]>
): string => {
  return options.reduce(
    (acc, [condition, token]) => (condition ? `${acc} ${token}` : acc),
    base
  );
};

export const PatchNode = memo(function PatchNode({
  node,
  position,
  width,
  selected,
  onPointerDown,
  onPointerUp,
  onDragStart,
  onDrag,
  onDragEnd,
  onOutputPointerDown,
  onInputPointerUp,
  controls,
  inputConnections,
  outputConnections,
  activeOutputPortId,
  onControlChange,
  widget,
  onContextMenu,
  onDoubleClick
}: PatchNodeProps): JSX.Element {
  const handleContainerPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    event.stopPropagation();
    onPointerDown(node.id, event, "body");
  };

  const handleHeaderPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    event.stopPropagation();
    onPointerDown(node.id, event, "header");
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragStart(node.id, event);
  };

  const handleHeaderPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      onDrag(node.id, event);
    }
  };

  const handleHeaderPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      onDragEnd(node.id, event);
      onPointerUp(node.id, event, "header");
    }
  };

  return (
    <div
      className={`patch-node${selected ? " patch-node--selected" : ""}`}
      style={{
        width: `${width}px`,
        transform: `translate(${position.x}px, ${position.y}px)`
      }}
      role="button"
      tabIndex={-1}
      onPointerDown={handleContainerPointerDown}
      onPointerUp={(event) => {
        event.stopPropagation();
        onPointerUp(node.id, event, "body");
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        onContextMenu(node.id, event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.(node.id, event);
      }}
    >
      <div
        className="patch-node__header"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        <span className="patch-node__subtitle">{node.kind}</span>
      </div>
      <div className="patch-node__ports">
        <div className="patch-node__ports-column">
          {node.inputs.map((port, index) => {
            const isConnected = (inputConnections[port.id] ?? 0) > 0;
            const portClassName = classNames("patch-node__port patch-node__port--input", [
              [isConnected, "patch-node__port--connected"]
            ]);
            return (
              <button
                key={port.id}
                type="button"
                className={portClassName}
                data-node-id={node.id}
                data-port-id={port.id}
                data-port-kind="input"
                onPointerUp={(event) =>
                  onInputPointerUp(node.id, port.id, index, event)
                }
              >
                <span
                  className="patch-node__port-indicator"
                  data-node-id={node.id}
                  data-port-id={port.id}
                  data-port-kind="input"
                />
                <span className="patch-node__port-label">{port.name}</span>
              </button>
            );
          })}
        </div>
        <div className="patch-node__ports-column patch-node__ports-column--outputs">
          {node.outputs.map((port, index) => {
            const isConnected = (outputConnections[port.id] ?? 0) > 0;
            const isActive = activeOutputPortId === port.id;
            const portClassName = classNames("patch-node__port patch-node__port--output", [
              [isConnected, "patch-node__port--connected"],
              [isActive, "patch-node__port--active"]
            ]);
            return (
              <button
                key={port.id}
                type="button"
                className={portClassName}
                data-node-id={node.id}
                data-port-id={port.id}
                data-port-kind="output"
                onPointerDown={(event) =>
                  onOutputPointerDown(node.id, port.id, index, event)
                }
              >
                <span className="patch-node__port-label">{port.name}</span>
                <span
                  className="patch-node__port-indicator"
                  data-node-id={node.id}
                  data-port-id={port.id}
                  data-port-kind="output"
                />
              </button>
            );
          })}
        </div>
      </div>
      {controls.length > 0 ? (
        <div className="patch-node__controls">
          {controls.map((control) => (
            <div key={control.id} className="patch-node__control">
              <Knob
                min={control.min}
                max={control.max}
                step={control.step}
                value={control.value}
                defaultValue={control.defaultValue}
                onChange={(next) => onControlChange(node.id, control.id, next)}
              />
              <span>{control.label}</span>
              <span className="patch-node__control-value">{control.value.toFixed(3)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {widget ? <div className="patch-node__widget">{widget}</div> : null}
    </div>
  );
});
