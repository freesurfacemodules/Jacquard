import { useCallback, useEffect, useRef, useState } from "react";
import { usePatch } from "../state/PatchContext";

export function Toolbar(): JSX.Element {
  const { validation, compile, audio, artifact } = usePatch();
  const [compileStatus, setCompileStatus] = useState<
    "idle" | "compiling" | "ready" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const previousAudioState = useRef(audio.state);

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

  const isRunning = audio.state === "running";
  const runDisabled =
    (!isRunning && compileStatus !== "ready") ||
    audio.state === "starting" ||
    !audio.isSupported;

  return (
    <header className="toolbar" aria-label="Application controls">
      <div className="toolbar-section">
        <strong>MaxWasm</strong>
      </div>
      <div className="toolbar-section">
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
          {isRunning ? "Stop" : "Run"}
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
    </header>
  );
}
