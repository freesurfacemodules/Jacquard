import { ChangeEvent, useMemo } from "react";
import { usePatch } from "../../state/PatchContext";
import { getNodeImplementation } from "@dsp/nodes";
import { resolveControlMin, resolveControlMax, resolveControlStep } from "@dsp/utils/controls";

interface NodePropertiesPanelProps {
  onClose(): void;
}

export function NodePropertiesPanel({ onClose }: NodePropertiesPanelProps): JSX.Element {
  const {
    viewModel,
    selectedNodeId,
    getParameterValue,
    updateNodeParameter,
    disconnectConnection,
    removeNode
  } = usePatch();

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return viewModel.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, viewModel.nodes]);

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

  const handleControlChange = (nodeId: string, controlId: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    updateNodeParameter(nodeId, controlId, value);
  };

  return (
    <aside className="dock-panel" aria-label="Node properties">
      <header className="dock-panel__header">
        <h2 className="dock-panel__title">Node Properties</h2>
        <button type="button" className="dock-panel__close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dock-panel__body">
        {!selectedNode ? (
          <p className="dock-panel__placeholder">Select a node to edit its parameters.</p>
        ) : (
          <>
            <div className="properties-section">
              <h3>{selectedNode.label}</h3>
              <span className="properties-section__subtitle">{selectedNode.kind}</span>
            </div>

            {implementation?.manifest.controls?.length ? (
              <section className="properties-section">
                <h4>Controls</h4>
                <div className="properties-controls">
                  {implementation.manifest.controls.map((control) => {
                    const value = getParameterValue(selectedNode.id, control.id);
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
                          {control.label}
                          <small>{value.toFixed(2)}</small>
                        </span>
                        <input
                          type="range"
                          min={sliderMin}
                          max={sliderMax}
                          step={stepValue > 0 ? stepValue : "any"}
                          value={value}
                          onChange={handleControlChange(selectedNode.id, control.id)}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}

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
        )}
      </div>
    </aside>
  );
}
