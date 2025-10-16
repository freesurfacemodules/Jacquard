import { ChangeEvent, useMemo } from "react";
import { usePatch } from "../state/PatchContext";
import { getNodeImplementation } from "@dsp/nodes";

export function Inspector(): JSX.Element {
  const {
    viewModel,
    validation,
    selectedNodeId,
    updateNodeParameter
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
                    const value = selectedNode.parameters[control.id];
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
