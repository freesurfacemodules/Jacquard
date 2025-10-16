import { useCallback } from "react";
import { usePatch } from "../state/PatchContext";
import { instantiateNode } from "@dsp/nodes";
import { nanoid } from "@codegen/utils/nanoid";
import { NodePalette } from "./NodePalette";

export function Canvas(): JSX.Element {
  const { viewModel, addNode } = usePatch();

  const handleCreateNode = useCallback(
    (kind: string) => {
      const node = instantiateNode(kind, nanoid());
      addNode(node);
    },
    [addNode]
  );

  return (
    <section className="canvas-pane" aria-label="Patch editor">
      <header className="canvas-header">
        <h1>Patch</h1>
        <NodePalette onCreateNode={handleCreateNode} />
      </header>
      <div className="canvas-body">
        {viewModel.nodes.length === 0 ? (
          <p className="placeholder">
            Drop oscillators, filters, and utilities here to start building a
            graph.
          </p>
        ) : (
          <pre>{JSON.stringify(viewModel, null, 2)}</pre>
        )}
      </div>
    </section>
  );
}
