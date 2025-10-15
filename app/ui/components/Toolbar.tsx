import { useCallback, useEffect, useState } from "react";
import { compilePatch } from "@compiler/compiler";
import { usePatch } from "../state/PatchContext";

export function Toolbar(): JSX.Element {
  const { graph, validation } = usePatch();
  const [isRunning, setIsRunning] = useState(false);
  const [compileStatus, setCompileStatus] = useState<
    "idle" | "compiling" | "ready" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const toggleRun = (): void => {
    // Hooked up to audio worklet bootstrap in future patch.
    setIsRunning((prev) => !prev);
  };

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
      await compilePatch(graph);
      setCompileStatus("ready");
      setSuccessMessage("Compiled successfully.");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unknown compile error";
      setErrorMessage(message);
      setCompileStatus("error");
    }
  }, [graph, validation]);

  useEffect(() => {
    setCompileStatus("idle");
    setSuccessMessage(null);
    setErrorMessage(null);
    setIsRunning(false);
  }, [graph]);

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
          onClick={toggleRun}
          className="toolbar-button"
          disabled={!isRunning && compileStatus !== "ready"}
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
    </header>
  );
}
