import { useCallback, useState } from "react";
import { compilePatch } from "@compiler/compiler";
import { usePatch } from "../state/PatchContext";

export function Toolbar(): JSX.Element {
  const { graph } = usePatch();
  const [isRunning, setIsRunning] = useState(false);
  const [compileStatus, setCompileStatus] = useState<
    "idle" | "compiling" | "ready" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleRun = (): void => {
    // Hooked up to audio worklet bootstrap in future patch.
    setIsRunning((prev) => !prev);
  };

  const handleCompile = useCallback(async () => {
    setCompileStatus("compiling");
    setErrorMessage(null);
    try {
      await compilePatch(graph);
      setCompileStatus("ready");
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unknown compile error";
      setErrorMessage(message);
      setCompileStatus("error");
    }
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
        <button type="button" onClick={toggleRun} className="toolbar-button">
          {isRunning ? "Stop" : "Run"}
        </button>
      </div>
      {compileStatus === "error" && errorMessage ? (
        <div className="toolbar-section error">{errorMessage}</div>
      ) : null}
    </header>
  );
}
