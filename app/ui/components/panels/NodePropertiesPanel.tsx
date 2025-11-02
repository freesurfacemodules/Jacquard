import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { usePatch } from "../../state/PatchContext";
import { getNodeImplementation } from "@dsp/nodes";
import type { SubpatchGraph } from "@graph/types";
import { resolveControlMin, resolveControlMax, resolveControlStep } from "@dsp/utils/controls";

interface NodePropertiesPanelProps {
  onClose(): void;
}

export function NodePropertiesPanel({ onClose }: NodePropertiesPanelProps): JSX.Element {
  const {
    viewModel,
    selectedNodeId,
    selectedNodeIds,
    getParameterValue,
    updateNodeParameter,
    disconnectConnection,
    removeNode,
    renameNode,
    renameNodeOutput,
    openSubpatch,
    rootGraph,
    activeSubpatchPath,
    renameSubpatchPort,
    addSubpatchPort,
    removeSubpatchPort
  } = usePatch();

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return viewModel.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, viewModel.nodes]);

  const [labelDraft, setLabelDraft] = useState<string>("");

  useEffect(() => {
    if (selectedNode) {
      setLabelDraft(selectedNode.label);
    } else {
      setLabelDraft("");
    }
  }, [selectedNode?.id, selectedNode?.label]);

  const implementation = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    return getNodeImplementation(selectedNode.kind) ?? null;
  }, [selectedNode]);

  const connectionDetails = useMemo(() => {
    if (!selectedNode) {
      return { incoming: [], outgoing: [] };
    }
    const nodeMap = new Map(viewModel.nodes.map((node) => [node.id, node]));

    const incoming = viewModel.connections
      .filter((connection) => connection.to.node === selectedNode.id)
      .map((connection) => {
        const sourceNode = nodeMap.get(connection.from.node);
        const sourcePort = sourceNode?.outputs.find((port) => port.id === connection.from.port);
        const targetPort = selectedNode.inputs.find((port) => port.id === connection.to.port);
        return {
          connectionId: connection.id,
          sourceLabel: sourceNode?.label ?? connection.from.node,
          sourcePort: sourcePort?.name ?? connection.from.port,
          targetPort: targetPort?.name ?? connection.to.port
        };
      });

    const outgoing = viewModel.connections
      .filter((connection) => connection.from.node === selectedNode.id)
      .map((connection) => {
        const targetNode = nodeMap.get(connection.to.node);
        const targetPort = targetNode?.inputs.find((port) => port.id === connection.to.port);
        const sourcePort = selectedNode.outputs.find((port) => port.id === connection.from.port);
        return {
          connectionId: connection.id,
          targetLabel: targetNode?.label ?? connection.to.node,
          targetPort: targetPort?.name ?? connection.to.port,
          sourcePort: sourcePort?.name ?? connection.from.port
        };
      });

    return { incoming, outgoing };
  }, [selectedNode, viewModel.connections, viewModel.nodes]);

  const handleSliderChange = (nodeId: string, controlId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    updateNodeParameter(nodeId, controlId, value);
  };

  const handleSelectChange = (nodeId: string, controlId: string) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number.parseFloat(event.target.value);
    updateNodeParameter(nodeId, controlId, value);
  };

  const handleLabelBlur = () => {
    if (!selectedNode) {
      return;
    }
    if (!labelDraft.trim()) {
      setLabelDraft(selectedNode.label);
      return;
    }
    renameNode(selectedNode.id, labelDraft);
  };

  const handleLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      (event.currentTarget as HTMLInputElement).blur();
    }
  };

  const currentSubpatchEntry: SubpatchGraph | null = selectedNode?.subpatchId
    ? rootGraph.subpatches?.[selectedNode.subpatchId] ?? null
    : null;

  const activeSubpatchId =
    activeSubpatchPath.length > 0 ? activeSubpatchPath[activeSubpatchPath.length - 1] : null;
  const activeSubpatchEntry: SubpatchGraph | null = activeSubpatchId
    ? rootGraph.subpatches?.[activeSubpatchId] ?? null
    : null;

  const renderPortEditors = (
    entry: SubpatchGraph | null,
    direction: "input" | "output",
    heading: string,
    emptyMessage: string,
    options?: { allowAdd?: boolean; allowRemove?: boolean }
  ): JSX.Element => {
    const specs = entry
      ? (direction === "input" ? entry.inputs : entry.outputs)
          .slice()
          .sort((a, b) => a.order - b.order)
      : [];

    return (
      <section className="properties-section">
        <div className="properties-section__header">
          <h4>{heading}</h4>
          {options?.allowAdd && entry ? (
            <button
              type="button"
              className="properties-action properties-action--inline"
              onClick={() => addSubpatchPort(entry.id, direction)}
            >
              Add {direction === "input" ? "input" : "output"}
            </button>
          ) : null}
        </div>
        {specs.length === 0 ? (
          <p className="dock-panel__placeholder">{emptyMessage}</p>
        ) : (
          specs.map((spec) => (
            <label key={`${direction}-${spec.id}`} className="properties-field">
              <span>{spec.name}</span>
              <div className="properties-field__control">
                <input
                  key={`${direction}-${spec.id}:${spec.name}`}
                  type="text"
                  defaultValue={spec.name}
                  onBlur={(event) =>
                    entry &&
                    renameSubpatchPort(entry.id, direction, spec.id, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                />
                {options?.allowRemove && entry ? (
                  <button
                    type="button"
                    className="properties-field__remove"
                    onClick={() => removeSubpatchPort(entry.id, direction, spec.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </label>
          ))
        )}
      </section>
    );
  };

  const controlNames =
    (selectedNode?.metadata?.controlNames as Record<string, string> | undefined) ?? {};

  return (
    <aside className="dock-panel" aria-label="Node properties">
      <header className="dock-panel__header">
        <h2 className="dock-panel__title">Node Properties</h2>
        <button type="button" className="dock-panel__close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dock-panel__body">
        {selectedNodeIds.length === 0 ? (
          <p className="dock-panel__placeholder">Select a node to edit its parameters.</p>
        ) : selectedNodeIds.length > 1 ? (
          <div className="properties-section">
            <p className="dock-panel__placeholder">Multiple nodes selected.</p>
          </div>
        ) : selectedNode ? (
          <>
            <div className="properties-section">
              <label className="properties-field">
                <span>Name</span>
                <input
                  type="text"
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onBlur={handleLabelBlur}
                  onKeyDown={handleLabelKeyDown}
                />
              </label>
              <span className="properties-section__subtitle">{selectedNode.kind}</span>
            {selectedNode.kind === "logic.subpatch" && selectedNode.subpatchId ? (
              <button
                type="button"
                className="properties-action"
                onClick={() => openSubpatch(selectedNode.subpatchId!)}
              >
                Open subpatch
              </button>
            ) : null}
            </div>

            {implementation?.manifest.controls?.length ? (
              <section className="properties-section">
                <h4>Controls</h4>
                <div className="properties-controls">
                  {implementation.manifest.controls.map((control) => {
                    const value = getParameterValue(selectedNode.id, control.id);
                    const controlLabel = controlNames[control.id] ?? control.label;
                    if (control.type === "slider") {
                      const context = { oversampling: viewModel.oversampling };
                      const minValue = resolveControlMin(control, context);
                      const maxValue = resolveControlMax(control, context);
                      const sliderMin = Number.isFinite(minValue) ? minValue : 0;
                      let sliderMax = Number.isFinite(maxValue) ? maxValue : sliderMin + 1;
                      if (sliderMax <= sliderMin) {
                        sliderMax = sliderMin + 1;
                      }
                      const stepValue = resolveControlStep(control, context);
                      return (
                        <label key={control.id} className="properties-control">
                          <span className="properties-control__label">
                            {controlLabel}
                            <small>{value.toFixed(2)}</small>
                          </span>
                          <input
                            type="range"
                            min={sliderMin}
                            max={sliderMax}
                            step={stepValue > 0 ? stepValue : "any"}
                            value={value}
                            onChange={handleSliderChange(selectedNode.id, control.id)}
                          />
                        </label>
                      );
                    }
                    const selectedOption =
                      control.options.find((option) => option.value === value) ?? null;
                    return (
                      <label key={control.id} className="properties-control">
                        <span className="properties-control__label">
                          {controlNames[control.id] ?? control.label}
                          <small>{selectedOption ? selectedOption.label : value.toFixed(2)}</small>
                        </span>
                        <select
                          value={value.toString()}
                          onChange={handleSelectChange(selectedNode.id, control.id)}
                        >
                          {control.options.map((option) => (
                            <option key={option.value} value={option.value.toString()}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {implementation?.manifest.renameableOutputs ?? false ? (
              <section className="properties-section">
                <h4>Outputs</h4>
                {selectedNode.outputs.map((port) => (
                  <label key={port.id} className="properties-field">
                    <span>{port.id}</span>
                    <div className="properties-field__control">
                      <input
                        type="text"
                        defaultValue={port.name}
                        onBlur={(event) =>
                          selectedNode && renameNodeOutput(selectedNode.id, port.id, event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            (event.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </div>
                  </label>
                ))}
              </section>
            ) : null}

            {selectedNode.kind === "logic.subpatch"
              ? currentSubpatchEntry
                ? (
                    <>
                      {renderPortEditors(
                        currentSubpatchEntry,
                        "input",
                        "Inputs",
                        "No inputs defined.",
                        { allowAdd: true, allowRemove: true }
                      )}
                      {renderPortEditors(
                        currentSubpatchEntry,
                        "output",
                        "Outputs",
                        "No outputs defined.",
                        { allowAdd: true, allowRemove: true }
                      )}
                    </>
                  )
                : (
                    <p className="dock-panel__placeholder">Subpatch metadata unavailable.</p>
                  )
              : null}

            {selectedNode.kind === "logic.subpatch.input"
              ? renderPortEditors(
                  activeSubpatchEntry,
                  "input",
                  "Subpatch inputs",
                  "No subpatch inputs defined.",
                  { allowRemove: true }
                )
              : null}

            {selectedNode.kind === "logic.subpatch.output"
              ? renderPortEditors(
                  activeSubpatchEntry,
                  "output",
                  "Subpatch outputs",
                  "No subpatch outputs defined.",
                  { allowRemove: true }
                )
              : null}

            <section className="properties-section">
              <h4>Connections</h4>
              {connectionDetails.incoming.length === 0 && connectionDetails.outgoing.length === 0 ? (
                <p className="dock-panel__placeholder">No connections for this node.</p>
              ) : (
                <div className="properties-connections">
                  {connectionDetails.incoming.length > 0 ? (
                    <div>
                      <h5>Inputs</h5>
                      <ul>
                        {connectionDetails.incoming.map((entry) => (
                          <li key={entry.connectionId}>
                            <span>
                              {entry.sourceLabel} • {entry.sourcePort} → {entry.targetPort}
                            </span>
                            <button
                              type="button"
                              onClick={() => disconnectConnection(entry.connectionId)}
                            >
                              Disconnect
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {connectionDetails.outgoing.length > 0 ? (
                    <div>
                      <h5>Outputs</h5>
                      <ul>
                        {connectionDetails.outgoing.map((entry) => (
                          <li key={entry.connectionId}>
                            <span>
                              {entry.sourcePort} → {entry.targetLabel} • {entry.targetPort}
                            </span>
                            <button
                              type="button"
                              onClick={() => disconnectConnection(entry.connectionId)}
                            >
                              Disconnect
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="properties-section properties-section--danger">
              <button
                type="button"
                className="properties-delete"
                onClick={() => removeNode(selectedNode.id)}
              >
                Delete Node
              </button>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}
