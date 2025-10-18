import { useMemo } from "react";
import { usePatch } from "../../state/PatchContext";

interface AssemblyPanelProps {
  onClose(): void;
}

const KEYWORDS = [
  "const",
  "let",
  "export",
  "function",
  "return",
  "class",
  "new",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue"
];

const KEYWORD_REGEX = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");

function highlightAssembly(source: string): string {
  const escaped = source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(KEYWORD_REGEX, '<span class="code-token--kw">$1</span>');
}

export function AssemblyPanel({ onClose }: AssemblyPanelProps): JSX.Element {
  const { artifact } = usePatch();

  const highlighted = useMemo(() => {
    if (!artifact?.moduleSource) {
      return "";
    }
    return highlightAssembly(artifact.moduleSource);
  }, [artifact?.moduleSource]);

  return (
    <aside className="dock-panel" aria-label="AssemblyScript output">
      <header className="dock-panel__header">
        <h2 className="dock-panel__title">Generated AssemblyScript</h2>
        <button type="button" className="dock-panel__close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dock-panel__body dock-panel__body--code">
        {!artifact?.moduleSource ? (
          <p className="dock-panel__placeholder">Compile the patch to generate AssemblyScript.</p>
        ) : (
          <pre className="code-block" dangerouslySetInnerHTML={{ __html: highlighted }} />
        )}
      </div>
    </aside>
  );
}
