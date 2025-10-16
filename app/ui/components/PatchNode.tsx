import { NodeDescriptor } from "@graph/types";
import { memo } from "react";
import type { NodeImplementation } from "@dsp/types";
import { getNodeImplementation } from "@dsp/library";
import { Knob } from "./Knob";

export type PortKind = "input" | "output";

interface PatchNodeProps {
  node: NodeDescriptor;
  position: { x: number; y: number };
  width: number;
  selected: boolean;
  onSelect(nodeId: string): void;
  onDragStart(nodeId: string, event: React.PointerEvent<HTMLDivElement>): void;
  onDrag(nodeId: string, event: React.PointerEvent<HTMLDivElement>): void;
  onDragEnd(nodeId: string, event: React.PointerEvent<HTMLDivElement>): void;
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
  controlValues: Record<string, number>;
  onControlChange(nodeId: string, controlId: string, value: number): void;
}

export const PatchNode = memo(function PatchNode({
  node,
  position,
  width,
  selected,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onOutputPointerDown,
  onInputPointerUp,
  controlValues,
  onControlChange
}: PatchNodeProps): JSX.Element {
  const implementation: NodeImplementation | undefined = getNodeImplementation(node.kind);
  const controls = implementation?.manifest.controls ?? [];

  const handleContainerPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    event.stopPropagation();
    onSelect(node.id);
  };

  const handleHeaderPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    event.stopPropagation();
    onSelect(node.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragStart(node.id, event);
  };

  const handleHeaderPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      onDrag(node.id, event);
    }
  };

  const handleHeaderPointerUp = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      onDragEnd(node.id, event);
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
    >
      <div
        className="patch-node__header"
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
      >
        <span className="patch-node__title">{node.label}</span>
        <span className="patch-node__subtitle">{node.kind}</span>
      </div>
      <div className="patch-node__ports">
        <div className="patch-node__ports-column">
          {node.inputs.map((port, index) => (
            <button
              key={port.id}
              type="button"
              className="patch-node__port patch-node__port--input"
              onPointerUp={(event) =>
                onInputPointerUp(node.id, port.id, index, event)
              }
            >
              <span className="patch-node__port-label">{port.name}</span>
            </button>
          ))}
        </div>
        <div className="patch-node__ports-column patch-node__ports-column--outputs">
          {node.outputs.map((port, index) => (
            <button
              key={port.id}
              type="button"
              className="patch-node__port patch-node__port--output"
              onPointerDown={(event) =>
                onOutputPointerDown(node.id, port.id, index, event)
              }
            >
              <span className="patch-node__port-label">{port.name}</span>
            </button>
          ))}
        </div>
      </div>
      {controls.length > 0 ? (
        <div className="patch-node__controls">
          {controls.map((control) => {
            const value =
              controlValues[control.id] ??
              node.parameters[control.id] ??
              implementation?.manifest.defaultParams?.[control.id] ??
              control.min ?? 0;
            return (
              <div key={control.id} className="patch-node__control">
                <Knob
                  min={control.min}
                  max={control.max}
                  step={control.step ?? 0.01}
                  value={value}
                  onChange={(next) => onControlChange(node.id, control.id, next)}
                />
                <span>{control.label}</span>
                <span className="patch-node__control-value">{value.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
