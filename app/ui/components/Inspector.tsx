import { usePatch } from "../state/PatchContext";

export function Inspector(): JSX.Element {
  const { viewModel } = usePatch();

  return (
    <aside className="inspector-pane" aria-label="Node inspector">
      <header className="inspector-header">
        <h2>Patch Settings</h2>
      </header>
      <div className="inspector-body">
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
        <p>Select a node to view and tweak its parameters.</p>
      </div>
    </aside>
  );
}
