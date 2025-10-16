import { ChangeEvent, useMemo } from "react";
import { usePatch } from "../state/PatchContext";
import { getNodeImplementation } from "@dsp/nodes";

const SAMPLE_RATE_OPTIONS = [44_100, 48_000, 96_000] as const;
const BLOCK_SIZE_OPTIONS = [128, 256, 512] as const;
const OVERSAMPLING_OPTIONS = [1, 2, 4, 8] as const;

export function Inspector(): JSX.Element {
  const {
    viewModel,
    validation,
    selectedNodeId,
    updateNodeParameter,
    getParameterValue,
    disconnectConnection,
    removeNode,
    updatePatchSettings
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

  const handleSampleRateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const sampleRate = Number.parseInt(event.target.value, 10);
    updatePatchSettings({ sampleRate });
  };

  const handleBlockSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const blockSize = Number.parseInt(event.target.value, 10) as (typeof BLOCK_SIZE_OPTIONS)[number];
    updatePatchSettings({ blockSize });
  };

  const handleOversamplingChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const oversampling = Number.parseInt(event.target.value, 10) as (typeof OVERSAMPLING_OPTIONS)[number];
    updatePatchSettings({ oversampling });
  };

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
          <div className="inspector-settings">
            <label className="inspector-setting">
              <span>Sample rate</span>
              <select
                value={viewModel.sampleRate}
                onChange={handleSampleRateChange}
              >
                {SAMPLE_RATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toLocaleString()} Hz
                  </option>
                ))}
              </select>
            </label>
            <label className="inspector-setting">
              <span>Block size</span>
              <select value={viewModel.blockSize} onChange={handleBlockSizeChange}>
                {BLOCK_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} frames
                  </option>
                ))}
              </select>
            </label>
            <label className="inspector-setting">
              <span>Oversampling</span>
              <select
                value={viewModel.oversampling}
                onChange={handleOversamplingChange}
              >
                {OVERSAMPLING_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}×
                  </option>
                ))}
              </select>
            </label>
          </div>
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
