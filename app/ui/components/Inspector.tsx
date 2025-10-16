import { ChangeEvent, useMemo } from "react";
import { usePatch } from "../state/PatchContext";
import { getNodeImplementation } from "@dsp/nodes";

export function Inspector(): JSX.Element {
  const {
    viewModel,
    validation,
    selectedNodeId,
    updateNodeParameter,
    getParameterValue,
    disconnectConnection,
    removeNode
  } = usePatch();
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    return viewModel.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, viewModel.nodes]);

  const selectedImplementation = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    return getNodeImplementation(selectedNode.kind) ?? null;
  }, [selectedNode]);

  const connectionDetails = useMemo(() => {
    if (!selectedNode) {
      return {
        incoming: [],
        outgoing: []
      };
    }

    const nodeMap = new Map(viewModel.nodes.map((node) => [node.id, node]));

    const incoming = viewModel.connections
      .filter((connection) => connection.to.node === selectedNode.id)
      .map((connection) => {
        const sourceNode = nodeMap.get(connection.from.node);
        const sourcePort = sourceNode?.outputs.find(
          (port) => port.id === connection.from.port
        );
        const targetPort = selectedNode.inputs.find(
          (port) => port.id === connection.to.port
        );
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
        const targetPort = targetNode?.inputs.find(
          (port) => port.id === connection.to.port
        );
        const sourcePort = selectedNode.outputs.find(
          (port) => port.id === connection.from.port
        );
        return {
          connectionId: connection.id,
          targetLabel: targetNode?.label ?? connection.to.node,
          targetPort: targetPort?.name ?? connection.to.port,
          sourcePort: sourcePort?.name ?? connection.from.port
        };
      });

    return { incoming, outgoing };
  }, [selectedNode, viewModel.connections, viewModel.nodes]);

  const statusMessage = useMemo(() => {
    if (validation.isValid) {
      return "Graph is valid and ready to compile.";
    }
    return "Fix the issues below before compiling.";
  }, [validation.isValid]);

  const handleControlChange = (
    nodeId: string,
    controlId: string
  ) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    updateNodeParameter(nodeId, controlId, value);
  };

  return (
    <aside className="inspector-pane" aria-label="Node inspector">
      <header className="inspector-header">
        <h2>Inspector</h2>
      </header>
      <div className="inspector-body">
        <section className="inspector-section">
          <h3>Patch Settings</h3>
          <dl>
            <div className="inspector-row">
              <dt>Sample rate</dt>
              <dd>{viewModel.sampleRate} Hz</dd>
            </div>
            <div className="inspector-row">
              <dt>Block size</dt>
              <dd>{viewModel.blockSize} frames</dd>
            </div>
            <div className="inspector-row">
              <dt>Oversampling</dt>
              <dd>{viewModel.oversampling}×</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section">
          <h3>Node</h3>
          {selectedNode && selectedImplementation ? (
            <div className="inspector-node">
              <div className="inspector-node__header">
                <strong>{selectedNode.label}</strong>
                <span>{selectedNode.kind}</span>
              </div>
              {selectedImplementation.manifest.controls?.length ? (
                <div className="inspector-controls">
                  {selectedImplementation.manifest.controls.map((control) => {
                    const value = getParameterValue(selectedNode.id, control.id);
                    return (
                      <label key={control.id} className="inspector-control">
                        <span className="inspector-control__label">
                          {control.label}
                          <small>{value.toFixed(2)}</small>
                        </span>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step ?? 0.1}
                          value={value}
                          onChange={handleControlChange(
                            selectedNode.id,
                            control.id
                          )}
                        />
                      </label>
                    );
                  })}
                  <p className="inspector-control__hint">
                    Adjusting parameters requires recompiling to hear changes.
                  </p>
                </div>
              ) : (
                <p className="inspector-placeholder">
                  This node does not expose adjustable parameters.
                </p>
              )}
              <div className="inspector-connections">
                <h4>Connections</h4>
                {connectionDetails.incoming.length === 0 &&
                connectionDetails.outgoing.length === 0 ? (
                  <p className="inspector-placeholder">
                    No active connections for this node.
                  </p>
                ) : (
                  <>
                    {connectionDetails.incoming.length > 0 ? (
                      <div className="inspector-connection-group">
                        <h5>Inputs</h5>
                        <ul className="inspector-connection-list">
                          {connectionDetails.incoming.map((entry) => (
                            <li
                              key={entry.connectionId}
                              className="inspector-connection-item"
                            >
                              <span>
                                {entry.sourceLabel} • {entry.sourcePort} →{" "}
                                {entry.targetPort}
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
                      <div className="inspector-connection-group">
                        <h5>Outputs</h5>
                        <ul className="inspector-connection-list">
                          {connectionDetails.outgoing.map((entry) => (
                            <li
                              key={entry.connectionId}
                              className="inspector-connection-item"
                            >
                              <span>
                                {entry.sourcePort} → {entry.targetLabel} •{" "}
                                {entry.targetPort}
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
                  </>
                )}
              </div>
              <button
                type="button"
                className="inspector-danger-button"
                onClick={() => removeNode(selectedNode.id)}
              >
                Delete Node
              </button>
            </div>
          ) : (
            <p className="inspector-placeholder">
              Select a node in the canvas to edit its parameters.
            </p>
          )}
        </section>

        <section className="inspector-section">
          <div
            className={`validation-status ${
              validation.isValid ? "ok" : "error"
            }`}
            role="status"
          >
            {statusMessage}
          </div>
          {!validation.isValid ? (
            <ul className="validation-list">
              {validation.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <strong>{issue.code}:</strong> {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
