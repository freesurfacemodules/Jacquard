import { useMemo } from "react";
import { builtinNodes } from "@dsp/nodes";

export interface NodePaletteProps {
  onCreateNode(kind: string): void;
}

interface CategoryGroup {
  name: string;
  items: typeof builtinNodes;
}

export function NodePalette({ onCreateNode }: NodePaletteProps): JSX.Element {
  const groups = useMemo<CategoryGroup[]>(() => {
    const byCategory = new Map<string, typeof builtinNodes>();
    for (const node of builtinNodes) {
      const list = byCategory.get(node.category) ?? [];
      list.push(node);
      byCategory.set(node.category, list);
    }

    return Array.from(byCategory.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: items.slice().sort((lhs, rhs) => lhs.label.localeCompare(rhs.label))
      }));
  }, []);

  return (
    <div className="node-palette" aria-label="Node palette">
      {groups.map((group) => (
        <section key={group.name} className="node-palette-group">
          <header>{group.name}</header>
          <div className="node-palette-items">
            {group.items.map((node) => (
              <button
                key={node.kind}
                type="button"
                className="node-palette-item"
                onClick={() => onCreateNode(node.kind)}
              >
                <span className="node-palette-label">{node.label}</span>
                <span className="node-palette-kind">{node.kind}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
