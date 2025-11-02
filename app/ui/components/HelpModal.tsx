import { useEffect, useRef } from "react";
import { HELP_CONTENT, HelpBlock } from "@ui/help/content";

interface HelpModalProps {
  open: boolean;
  onClose(): void;
  showOnStartup: boolean;
  onShowOnStartupChange(value: boolean): void;
}

function renderBlock(block: HelpBlock, index: number): JSX.Element {
  if (block.type === "paragraph") {
    return <p key={index}>{block.text}</p>;
  }
  return (
    <ul key={index}>
      {block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{item}</li>
      ))}
    </ul>
  );
}

export function HelpModal({
  open,
  onClose,
  showOnStartup,
  onShowOnStartupChange
}: HelpModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      const element = panelRef.current;
      element?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="help-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="help-modal__backdrop" onClick={onClose} />
      <div
        className="help-modal__panel"
        tabIndex={-1}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="help-modal__close"
          aria-label="Close help window"
          onClick={onClose}
        >
          ×
        </button>
        <h1 id="help-modal-title">{HELP_CONTENT.title}</h1>
        <div className="help-modal__scroll">
          {HELP_CONTENT.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.blocks.map(renderBlock)}
            </section>
          ))}
        </div>
        <label className="help-modal__startup">
          <input
            type="checkbox"
            checked={showOnStartup}
            onChange={(event) => onShowOnStartupChange(event.target.checked)}
          />
          Display this help on startup
        </label>
      </div>
    </div>
  );
}
