import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
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

  return (
    <header className="toolbar" aria-label="Application controls">
      <div className="toolbar-section">
        <strong>MaxWasm</strong>
      </div>
      <div className="toolbar-section">
        <button
          type="button"
          onClick={handleUndo}
          className="toolbar-button"
          disabled={!canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleRedo}
          className="toolbar-button"
          disabled={!canRedo}
        >
          Redo
        </button>
        <button
          type="button"
          onClick={handleSavePatch}
          className="toolbar-button"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleLoadClick}
          className="toolbar-button"
        >
          Load
        </button>
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
          className="toolbar-button"
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
