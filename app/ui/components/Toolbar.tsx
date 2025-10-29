import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePatch } from "../state/PatchContext";
import type { WindowKey, WindowVisibility } from "./Workspace";

interface ToolbarProps {
  windows: WindowVisibility;
  onToggleWindow(key: WindowKey): void;
}

const WINDOW_MENU_ITEMS: Array<{ key: WindowKey; label: string }> = [
  { key: "nodeBrowser", label: "Node Browser" },
  { key: "nodeProperties", label: "Node Properties" },
  { key: "assemblyView", label: "Assembly Script" },
  { key: "audioSettings", label: "Audio Properties" }
];

export function Toolbar({ windows, onToggleWindow }: ToolbarProps): JSX.Element {
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
    importPatch,
    resetPatch
  } = usePatch();

  const [compileStatus, setCompileStatus] = useState<"idle" | "compiling" | "ready" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const previousAudioState = useRef(audio.state);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"patch" | "window" | null>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const toggleMenu = useCallback((menu: "patch" | "window") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openMenu]);

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
        firstIssue ? `${firstIssue.code}: ${firstIssue.message}` : "Graph has validation errors."
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
      const message = error instanceof Error ? error.message : "Unknown compile error";
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
      } else if (previousAudioState.current === "running" && audio.state === "idle") {
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
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `maxwasm-patch-${timestamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccessMessage("Patch saved.");
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save patch.";
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
        await audio.stop().catch(() => undefined);
        importPatch(payload, { recordHistory: false });
        setSuccessMessage(`Loaded patch from ${file.name}.`);
        setErrorMessage(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load patch file.";
        setErrorMessage(message);
        setSuccessMessage(null);
      } finally {
        event.target.value = "";
      }
    },
    [audio, importPatch]
  );

  const handleNewPatch = useCallback(() => {
    resetPatch();
    setSuccessMessage(null);
    setErrorMessage(null);
  }, [resetPatch]);

  const isRunning = audio.state === "running";
  const runDisabled =
    (!isRunning && compileStatus !== "ready") || audio.state === "starting" || !audio.isSupported;
  const runLabel = audio.state === "starting" ? "Starting…" : isRunning ? "Stop" : "Run";

  useEffect(() => {
    if (audio.error) {
      setSuccessMessage(null);
    }
  }, [audio.error]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openMenu) {
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
  }, [closeMenu, handleLoadClick, handleRedo, handleSavePatch, handleUndo, isMac, openMenu]);

  const patchMenuItems = useMemo(
    () => [
      { id: "new", label: "New Patch", disabled: false, action: handleNewPatch, hint: "" },
      { id: "undo", label: "Undo", disabled: !canUndo, action: handleUndo, hint: hotkeyLabels.undo },
      { id: "redo", label: "Redo", disabled: !canRedo, action: handleRedo, hint: hotkeyLabels.redo },
      { id: "save", label: "Save Patch…", disabled: false, action: handleSavePatch, hint: hotkeyLabels.save },
      { id: "load", label: "Load Patch…", disabled: false, action: handleLoadClick, hint: hotkeyLabels.load }
    ],
    [canRedo, canUndo, handleLoadClick, handleNewPatch, handleRedo, handleSavePatch, handleUndo, hotkeyLabels]
  );

  return (
    <div className="toolbar" ref={toolbarRef} aria-label="Application controls">
      <div className="toolbar-section toolbar-section--brand">
        <strong>MaxWasm</strong>
        <div className="toolbar-menubar">
          <button
            type="button"
            className={`toolbar-menu-button${openMenu === "patch" ? " toolbar-menu-button--open" : ""}`}
            onClick={() => toggleMenu("patch")}
          >
            Patch <span aria-hidden="true">▾</span>
          </button>
          {openMenu === "patch" ? (
            <div className="toolbar-menu" role="menu">
              {patchMenuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="toolbar-menu__item"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) {
                      return;
                    }
                    item.action();
                    closeMenu();
                  }}
                >
                  <span>{item.label}</span>
                  <span className="toolbar-menu__hint">{item.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="toolbar-menubar">
          <button
            type="button"
            className={`toolbar-menu-button${openMenu === "window" ? " toolbar-menu-button--open" : ""}`}
            onClick={() => toggleMenu("window")}
          >
            Window <span aria-hidden="true">▾</span>
          </button>
          {openMenu === "window" ? (
            <div className="toolbar-menu" role="menu">
              {WINDOW_MENU_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="toolbar-menu__item"
                  onClick={() => {
                    onToggleWindow(item.key);
                    closeMenu();
                  }}
                >
                  <span>{item.label}</span>
                  <span className="toolbar-menu__hint">
                    {windows[item.key] ? "●" : "○"}
                  </span>
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
      {audio.error ? <div className="toolbar-section error">{audio.error}</div> : null}
      {!audio.isSupported ? (
        <div className="toolbar-section error">Audio playback is unavailable in this environment.</div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}
