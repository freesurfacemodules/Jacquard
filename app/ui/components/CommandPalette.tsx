import { useEffect, useMemo, useState } from "react";
import { builtinNodes } from "@dsp/nodes";

interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  onSelect(kind: string): void;
}

interface PaletteItem {
  kind: string;
  label: string;
  category: string;
}

export function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const items = useMemo<PaletteItem[]>(() => {
    return builtinNodes
      .map((node) => ({ kind: node.kind, label: node.label, category: node.category }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return items;
    }
    return items.filter((item) => {
      return (
        item.label.toLowerCase().includes(normalized) ||
        item.kind.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized)
      );
    });
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const item = filtered[highlightedIndex];
        if (item) {
          onSelect(item.kind);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((index) => Math.min(filtered.length - 1, index + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((index) => Math.max(0, index - 1));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, highlightedIndex, onClose, onSelect, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      const input = document.getElementById("command-palette-input") as HTMLInputElement | null;
      input?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette" role="dialog" aria-modal="true">
      <div className="command-palette__backdrop" onClick={onClose} />
      <div className="command-palette__panel">
        <input
          id="command-palette-input"
          type="search"
          placeholder="Add node…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
          }}
        />
        <ul className="command-palette__results">
          {filtered.length === 0 ? (
            <li className="command-palette__empty">No nodes match “{query}”.</li>
          ) : (
            filtered.slice(0, 20).map((item, index) => {
              const isActive = index === highlightedIndex;
              return (
                <li key={item.kind}>
                  <button
                    type="button"
                    className={`command-palette__result${isActive ? " command-palette__result--active" : ""}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => onSelect(item.kind)}
                  >
                    <span className="command-palette__result-label">{item.label}</span>
                    <span className="command-palette__result-kind">{item.kind}</span>
                    <span className="command-palette__result-category">{item.category}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
