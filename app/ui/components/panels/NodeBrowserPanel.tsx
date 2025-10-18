import { useMemo, useState } from "react";
import { builtinNodes } from "@dsp/nodes";

interface NodeBrowserPanelProps {
  onCreateNode(kind: string): void;
  onClose(): void;
}

interface PaletteEntry {
  kind: string;
  label: string;
  category: string;
}

export function NodeBrowserPanel({ onCreateNode, onClose }: NodeBrowserPanelProps): JSX.Element {
  const [query, setQuery] = useState("");

  const entries = useMemo<PaletteEntry[]>(() => {
    return builtinNodes
      .map((node) => ({ kind: node.kind, label: node.label, category: node.category }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      return entries;
    }
    return entries.filter((entry) => {
      return (
        entry.label.toLowerCase().includes(normalizedQuery) ||
        entry.kind.toLowerCase().includes(normalizedQuery) ||
        entry.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [entries, normalizedQuery]);

  const groups = useMemo(() => {
    const grouped = new Map<string, PaletteEntry[]>();
    for (const entry of filtered) {
      const list = grouped.get(entry.category) ?? [];
      list.push(entry);
      grouped.set(entry.category, list);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <aside className="dock-panel dock-panel--left" aria-label="Node browser">
      <header className="dock-panel__header">
        <h2 className="dock-panel__title">Node Browser</h2>
        <button type="button" className="dock-panel__close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dock-panel__body">
        <div className="node-browser__search">
          <input
            type="search"
            placeholder="Search nodes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="node-browser__list">
          {groups.length === 0 ? (
            <p className="node-browser__empty">No nodes match “{query}”.</p>
          ) : (
            groups.map(([category, items]) => (
              <section key={category} className="node-browser__group">
                <header>{category}</header>
                <ul>
                  {items.map((entry) => (
                    <li key={entry.kind}>
                      <button
                        type="button"
                        onClick={() => onCreateNode(entry.kind)}
                        className="node-browser__item"
                      >
                        <span className="node-browser__item-label">{entry.label}</span>
                        <span className="node-browser__item-kind">{entry.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
