import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePatch } from "../state/PatchContext";

export function Toolbar(): JSX.Element {
  const {
    validation,
    compile,
    audio,
    artifact,
    undo,
    redo,
    canUndo,
    canRedo,
    exportPatch,
    importPatch
  } = usePatch();
  const [compileStatus, setCompileStatus] = useState<
    "idle" | "compiling" | "ready" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const previousAudioState = useRef(audio.state);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((previous) => !previous);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  const hotkeyLabels = useMemo(
    () => ({
      undo: isMac ? "⌘Z" : "Ctrl+Z",
      redo: isMac ? "⇧⌘Z" : "Ctrl+Y",
      save: isMac ? "⌘S" : "Ctrl+S",
      load: isMac ? "⌘O" : "Ctrl+O"
    }),
    [isMac]
  );

  const handleCompile = useCallback(async () => {
    if (!validation.isValid) {
      const firstIssue = validation.issues[0];
      setCompileStatus("error");
      setSuccessMessage(null);
      setErrorMessage(
        firstIssue
          ? `${firstIssue.code}: ${firstIssue.message}`
          : "Graph has validation errors."
      );
      return;
    }

    setCompileStatus("compiling");
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await compile();
      setCompileStatus("ready");
      setSuccessMessage("Compiled successfully.");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unknown compile error";
      setErrorMessage(message);
      setCompileStatus("error");
    }
  }, [compile, validation]);

  useEffect(() => {
    if (!artifact) {
      setCompileStatus("idle");
      setSuccessMessage(null);
      setErrorMessage(null);
    }
  }, [artifact]);

  useEffect(() => {
    if (previousAudioState.current !== audio.state) {
      if (audio.state === "running") {
        setSuccessMessage("Playback started.");
      } else if (
        previousAudioState.current === "running" &&
        audio.state === "idle"
      ) {
        setSuccessMessage("Playback stopped.");
      }
      previousAudioState.current = audio.state;
    }
  }, [audio.state]);

  const handleRunToggle = useCallback(async () => {
    if (audio.state === "running") {
      await audio.stop();
      return;
    }

    await audio.start();
  }, [audio]);

  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  const handleSavePatch = useCallback(() => {
    try {
      if (typeof window === "undefined") {
        throw new Error("Saving patches is only available in a browser.");
      }
      const patchDocument = exportPatch();
      const json = JSON.stringify(patchDocument, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `maxwasm-patch-${timestamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccessMessage("Patch saved.");
      setErrorMessage(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save patch.";
      setErrorMessage(message);
      setSuccessMessage(null);
    }
  }, [exportPatch]);

  const handleLoadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        importPatch(payload);
        setSuccessMessage(`Loaded patch from ${file.name}.`);
        setErrorMessage(null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load patch file.";
        setErrorMessage(message);
        setSuccessMessage(null);
      } finally {
        event.target.value = "";
      }
    },
    [importPatch]
  );

  const isRunning = audio.state === "running";
  const runDisabled =
    (!isRunning && compileStatus !== "ready") ||
    audio.state === "starting" ||
    !audio.isSupported;
  const runLabel =
    audio.state === "starting" ? "Starting…" : isRunning ? "Stop" : "Run";

  useEffect(() => {
    if (audio.error) {
      setSuccessMessage(null);
    }
  }, [audio.error]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        event.preventDefault();
        closeMenu();
        return;
      }

      const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
      if (!primaryModifier) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "z") {
        event.preventDefault();
        closeMenu();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (!isMac && key === "y") {
        event.preventDefault();
        closeMenu();
        handleRedo();
        return;
      }

      if (key === "s") {
        event.preventDefault();
        closeMenu();
        handleSavePatch();
        return;
      }

      if (key === "o") {
        event.preventDefault();
        closeMenu();
        handleLoadClick();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeMenu,
    handleLoadClick,
    handleRedo,
    handleSavePatch,
    handleUndo,
    isMac,
    menuOpen
  ]);

  const menuItems = [
    {
      id: "undo",
      label: "Undo",
      action: handleUndo,
      disabled: !canUndo,
      hotkey: hotkeyLabels.undo
    },
    {
      id: "redo",
      label: "Redo",
      action: handleRedo,
      disabled: !canRedo,
      hotkey: hotkeyLabels.redo
    },
    {
      id: "save",
      label: "Save Patch…",
      action: handleSavePatch,
      disabled: false,
      hotkey: hotkeyLabels.save
    },
    {
      id: "load",
      label: "Load Patch…",
      action: handleLoadClick,
      disabled: false,
      hotkey: hotkeyLabels.load
    }
  ];

  return (
    <header className="toolbar" aria-label="Application controls">
      <div className="toolbar-section toolbar-section--brand">
        <strong>MaxWasm</strong>
        <div className="toolbar-menubar" ref={menuRef}>
          <button
            type="button"
            className={`toolbar-menu-button${menuOpen ? " toolbar-menu-button--open" : ""}`}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            Patch <span aria-hidden="true">▾</span>
          </button>
          {menuOpen ? (
            <div className="toolbar-menu" role="menu">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="toolbar-menu__item"
                  onClick={() => {
                    if (item.disabled) {
                      return;
                    }
                    closeMenu();
                    item.action();
                  }}
                  disabled={item.disabled}
                >
                  <span>{item.label}</span>
                  <span className="toolbar-menu__hint">{item.hotkey}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="toolbar-section toolbar-section--actions">
        <button
          type="button"
          onClick={handleCompile}
          className="toolbar-button"
          disabled={compileStatus === "compiling"}
        >
          {compileStatus === "compiling" ? "Compiling…" : "Compile"}
        </button>
        <button
          type="button"
          onClick={handleRunToggle}
          className="toolbar-button toolbar-button--accent"
          disabled={runDisabled}
        >
          {runLabel}
        </button>
      </div>
      {compileStatus === "error" && errorMessage ? (
        <div className="toolbar-section error">{errorMessage}</div>
      ) : null}
      {compileStatus === "ready" && successMessage ? (
        <div className="toolbar-section success">{successMessage}</div>
      ) : null}
      {audio.error ? (
        <div className="toolbar-section error">{audio.error}</div>
      ) : null}
      {!audio.isSupported ? (
        <div className="toolbar-section error">
          Audio playback is unavailable in this environment.
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </header>
  );
}
